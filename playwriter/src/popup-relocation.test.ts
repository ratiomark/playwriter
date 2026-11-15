/**
 * Tests for auto-relocation of popup windows to tabs.
 * - Connected source tab → popup gets relocated + auto-attached.
 * - No source tab connected → popup is left alone.
 */

import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import dedent from 'string-dedent'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  createSimpleServer,
  type TestContext,
  type SimpleServer,
  js,
} from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19995
const CHILD_PAGE_TIMEOUT_MS = 5_000

type TabEvent = {
  event: string
  tabId: number
  groupId?: number
  groupChanged?: boolean
  status?: string
  sourceTabId?: number
}

declare global {
  var issue133Observer: { events: TabEvent[]; dispose: () => void } | undefined
}

describe('Popup window relocation', () => {
  let client: Awaited<ReturnType<typeof createMCPClient>>['client']
  let cleanup: (() => Promise<void>) | null = null
  let testCtx: TestContext | null = null
  let htmlServer: SimpleServer | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({
      port: TEST_PORT,
      tempDirPrefix: 'pw-popup-test-',
      toggleExtension: true,
    })

    const result = await createMCPClient({ port: TEST_PORT })
    client = result.client
    cleanup = result.cleanup

    htmlServer = await createSimpleServer({
      routes: {
        '/index.html': dedent`
          <!doctype html>
          <a id="open" href="/index.html?child=1" target="_blank">Open child tab</a>
          <button onclick="window.open('/index.html?popup=1', '', 'popup=1,width=600,height=500')">Open popup</button>
        `,
        '/index.html?child=1': '<!doctype html><h1>Ordinary child</h1>',
        '/index.html?popup=1': '<!doctype html><h1>Popup child</h1>',
        '/opener': `<!doctype html>
<html>
  <body>
    <button id="open-popup" onclick="window.open('/target', '', 'width=400,height=300,popup=1')">Open popup</button>
  </body>
</html>`,
        '/target': `<!doctype html>
<html>
  <body>
    <h1 id="target-heading">Popup target page</h1>
  </body>
</html>`,
      },
    })
  }, 600000)

  afterAll(async () => {
    if (htmlServer) {
      await htmlServer.close()
    }
    await cleanupTestContext(testCtx, cleanup)
    cleanup = null
    testCtx = null
  })

  it('relocates popup window into main browser context as a tab', async () => {
    if (!htmlServer) throw new Error('html server not initialized')
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          state.popupTestPage = await context.newPage();
          await state.popupTestPage.goto('${htmlServer.baseUrl}/opener', { waitUntil: 'domcontentloaded' });
          return { url: state.popupTestPage.url(), pagesBefore: context.pages().length };
        `,
      },
    })

    const clickResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.popupTestPage.click('#open-popup');
          await state.popupTestPage.waitForTimeout(1500);
          return { pagesAfter: context.pages().length, allUrls: context.pages().map((p) => p.url()) };
        `,
      },
    })

    const clickOutput = (clickResult as any).content[0].text as string

    expect(clickOutput).toContain('/target')
    expect((clickResult as any).isError).not.toBe(true)
    expect(clickOutput).toContain('[WARNING] New page opened from current page')
    expect(clickOutput).not.toContain('Popup window detected')
    expect(clickOutput).not.toContain('cannot be controlled by playwriter')

    const windowTypes = await serviceWorker.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: false })
      return windows.map((w) => w.type)
    })
    expect(windowTypes).not.toContain('popup')
    expect(windowTypes).toContain('normal')

    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const targetPage = context.pages().find((p) => p.url().endsWith('/target'));
          if (targetPage) { await targetPage.close(); }
          await state.popupTestPage.close();
          delete state.popupTestPage;
        `,
      },
    })
  }, 60000)

  // Chrome 155 omits the inherited group's change event; bundled Chromium 145 emits one.
  // Chrome 155 event log: https://github.com/remorses/playwriter/issues/133#issuecomment-6278536708
  it('issue 133: exposes a target=_blank child already born in the managed group', async () => {
    if (!htmlServer || !testCtx) throw new Error('test context not initialized')
    const baseUrl = htmlServer.baseUrl
    const serviceWorker = await getExtensionServiceWorker(testCtx.browserContext)
    console.log('Issue 133 environment:', {
      browser: testCtx.browserContext.browser()?.version(),
      node: process.version,
    })
    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
      await globalThis.toggleExtensionForActiveTab()
    })

    // Observe real Chrome events before parent creation, without changing attachment behavior.
    await serviceWorker.evaluate(() => {
      const events: TabEvent[] = []
      const onCreated = (tab: chrome.tabs.Tab) => {
        if (tab.id === undefined) return
        events.push({ event: 'created', tabId: tab.id, groupId: tab.groupId, status: tab.status })
      }
      const onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (tabId, change, tab) => {
        events.push({
          event: 'updated',
          tabId,
          groupId: tab.groupId,
          groupChanged: change.groupId !== undefined,
          status: change.status,
        })
      }
      const onTarget = (details: chrome.webNavigation.WebNavigationSourceCallbackDetails) => {
        events.push({ event: 'navigation-target', tabId: details.tabId, sourceTabId: details.sourceTabId })
      }
      chrome.tabs.onCreated.addListener(onCreated)
      chrome.tabs.onUpdated.addListener(onUpdated)
      chrome.webNavigation.onCreatedNavigationTarget.addListener(onTarget)
      globalThis.issue133Observer = {
        events,
        dispose: () => {
          chrome.tabs.onCreated.removeListener(onCreated)
          chrome.tabs.onUpdated.removeListener(onUpdated)
          chrome.webNavigation.onCreatedNavigationTarget.removeListener(onTarget)
        },
      }
    })

    try {
      console.log('Issue 133: create parent through the extension-backed MCP context')
      const parentResult = await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
            state.issue133Parent = await context.newPage();
            await state.issue133Parent.goto('${baseUrl}/index.html', { waitUntil: 'domcontentloaded' });
          `,
        },
      })
      expect(parentResult.isError).not.toBe(true)

      console.log('Issue 133: click the ordinary link and await an extension context page event')
      const childResult = await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
            const childOpened = context.waitForEvent('page', { timeout: ${CHILD_PAGE_TIMEOUT_MS} });
            const [child] = await Promise.all([childOpened, state.issue133Parent.locator('#open').click()]);
            state.issue133Child = child;
            const heading = await child.locator('h1').innerText({ timeout: ${CHILD_PAGE_TIMEOUT_MS} });
            return { url: child.url(), heading };
          `,
        },
      })

      const evidence = await serviceWorker.evaluate(async (baseUrl) => {
        const tabs = (await chrome.tabs.query({})).filter((tab) => {
          return tab.url === `${baseUrl}/index.html` || tab.url === `${baseUrl}/index.html?child=1`
        })
        const tabIds = tabs.map((tab) => {
          return tab.id
        })
        return {
          extensionVersion: chrome.runtime.getManifest().version,
          remoteControl: globalThis.getRemoteControlState(),
          tabs: tabs.map((tab) => {
            return {
              id: tab.id,
              groupId: tab.groupId,
              url: tab.url,
              status: tab.status,
              extensionState: globalThis.getExtensionState().tabs.get(tab.id!)?.state ?? null,
            }
          }),
          events: globalThis.issue133Observer!.events.filter((event) => {
            return tabIds.includes(event.tabId)
          }),
        }
      }, baseUrl)
      const contextResult = await client.callTool({
        name: 'execute',
        arguments: { code: 'console.log(JSON.stringify(context.pages().map((page) => { return page.url(); })));' },
      })
      console.log('Issue 133 evidence:', JSON.stringify({ evidence, contextResult, childResult }, null, 2))

      console.log('Issue 133: verify a separate popup still attaches as a positive control')
      const popupResult = await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
            const popupOpened = context.waitForEvent('page', { timeout: ${CHILD_PAGE_TIMEOUT_MS} });
            const [popup] = await Promise.all([popupOpened, state.issue133Parent.locator('button').click()]);
            const heading = await popup.locator('h1').innerText({ timeout: ${CHILD_PAGE_TIMEOUT_MS} });
            return { url: popup.url(), heading };
          `,
        },
      })
      console.log('Issue 133 popup control:', JSON.stringify(popupResult, null, 2))
      expect(popupResult.isError, JSON.stringify(popupResult)).not.toBe(true)
      expect(JSON.stringify(popupResult)).toContain('Popup child')
      expect(JSON.stringify(popupResult)).toContain(`${baseUrl}/index.html?popup=1`)

      const parent = evidence.tabs.find((tab) => {
        return tab.url === `${baseUrl}/index.html`
      })
      const child = evidence.tabs.find((tab) => {
        return tab.url === `${baseUrl}/index.html?child=1`
      })
      expect(parent?.extensionState).toBe('connected')
      expect(evidence.remoteControl).toBeNull()
      expect(parent?.groupId).toBeGreaterThanOrEqual(0)
      expect(child?.status).toBe('complete')
      expect(child?.groupId).toBe(parent?.groupId)
      expect(
        evidence.events.find((event) => {
          return event.event === 'created' && event.tabId === child?.id
        }),
      ).toMatchObject({ groupId: parent?.groupId })
      expect(childResult.isError, JSON.stringify({ evidence, contextResult, childResult }, null, 2)).not.toBe(true)
      expect(JSON.stringify(childResult)).toContain('Ordinary child')
      expect(JSON.stringify(childResult)).toContain(`${baseUrl}/index.html?child=1`)
      expect(contextResult.isError).not.toBe(true)
      expect(JSON.stringify(contextResult)).toContain(`${baseUrl}/index.html?child=1`)

      console.log('Issue 133: another loading event keeps the same child attached exactly once')
      const reloadResult = await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
            await state.issue133Child.reload({ waitUntil: 'domcontentloaded' });
            await state.issue133Child.locator('h1').innerText({ timeout: ${CHILD_PAGE_TIMEOUT_MS} });
            return context.pages().filter((page) => { return page.url() === '${baseUrl}/index.html?child=1'; }).length;
          `,
        },
      })
      expect(reloadResult.isError, JSON.stringify(reloadResult)).not.toBe(true)
      expect(reloadResult).toMatchObject({ content: [{ type: 'text', text: '[return value] 1' }] })
    } finally {
      await serviceWorker.evaluate(() => {
        globalThis.issue133Observer?.dispose()
        globalThis.issue133Observer = undefined
      })
    }
  }, 60000)

  it('leaves popup windows alone when no Playwriter tab is connected', async () => {
    if (!htmlServer) throw new Error('html server not initialized')
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })
    await new Promise((r) => {
      setTimeout(r, 200)
    })

    // Drive the browser directly via browserContext (not MCP/extension) so
    // the opener tab stays unconnected.
    const unconnectedPage = await browserContext.newPage()
    await unconnectedPage.goto(`${htmlServer.baseUrl}/opener`, { waitUntil: 'domcontentloaded' })
    await unconnectedPage.bringToFront()
    await unconnectedPage.click('#open-popup')
    // If relocation DID happen, the popup window would be gone by now.
    await new Promise((r) => {
      setTimeout(r, 1500)
    })

    const windowTypes = await serviceWorker.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: false })
      return windows.map((w) => w.type)
    })
    expect(windowTypes).toContain('popup')

    const windowIdsToClose = await serviceWorker.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: false })
      return windows.filter((w) => w.type === 'popup').map((w) => w.id)
    })
    for (const windowId of windowIdsToClose) {
      if (windowId !== undefined) {
        await serviceWorker.evaluate(async (id: number) => {
          await chrome.windows.remove(id)
        }, windowId)
      }
    }
    await unconnectedPage.close()
  }, 60000)
})
