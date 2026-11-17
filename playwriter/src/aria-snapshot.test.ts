import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import { Page } from '@xmorse/playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import dedent from 'string-dedent'
import { getAriaSnapshot } from './aria-snapshot.js'
import { getCdpUrl } from './utils.js'
import { getCDPSessionForPage } from './cdp-session.js'
import { setupTestContext, cleanupTestContext, getExtensionServiceWorker, type TestContext } from './test-utils.js'

const TEST_PORT = 19986
const SNAPSHOTS_DIR = path.join(import.meta.dirname, 'aria-snapshots')
const AX_DEBUG_DIR = path.join(import.meta.dirname, '__snapshots__', 'ax-debug')
const SHOULD_DUMP_AX = process.env.PLAYWRITER_DUMP_AX === '1'

type HtmlServer = {
  baseUrl: string
  close: () => Promise<void>
}

async function createHtmlServer({ htmlByPath }: { htmlByPath: Record<string, string> }): Promise<HtmlServer> {
  const openSockets: Set<net.Socket> = new Set()
  const server = http.createServer((req, res) => {
    const requestUrl = req.url || '/'
    const html = htmlByPath[requestUrl]
    if (!html) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
  })

  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => {
      openSockets.delete(socket)
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => {
      for (const socket of openSockets) {
        socket.destroy()
      }
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

describe('aria-snapshot', () => {
  let ctx: TestContext
  let page: Page

  beforeAll(async () => {
    ctx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'aria-snapshot-test-', toggleExtension: true })
    page = await ctx.browserContext.newPage()
    const serviceWorker = await getExtensionServiceWorker(ctx.browserContext)
    await page.goto('about:blank')
    await serviceWorker.evaluate(async () => {
      await (globalThis as any).toggleExtensionForActiveTab()
    })
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
    }
    if (SHOULD_DUMP_AX && !fs.existsSync(AX_DEBUG_DIR)) {
      fs.mkdirSync(AX_DEBUG_DIR, { recursive: true })
    }
  }, 60000)

  afterAll(async () => {
    await cleanupTestContext(ctx)
  })

  const sites = [
    { name: 'hackernews', url: 'https://news.ycombinator.com' },
    { name: 'github', url: 'https://github.com' },
    { name: 'prosemirror', url: 'https://prosemirror.net/' },
  ]

  for (const site of sites) {
    it(`${site.name} - snapshot`, async () => {
      await page.goto(site.url, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1000)

      if (SHOULD_DUMP_AX) {
        const cdp = await getCDPSessionForPage({ page })
        try {
          await cdp.send('DOM.enable')
          await cdp.send('Accessibility.enable')
          const axTree = await cdp.send('Accessibility.getFullAXTree')
          const domTree = await cdp.send('DOM.getFlattenedDocument', { depth: -1, pierce: true })
          fs.writeFileSync(path.join(AX_DEBUG_DIR, `${site.name}-ax-tree.json`), JSON.stringify(axTree, null, 2))
          fs.writeFileSync(path.join(AX_DEBUG_DIR, `${site.name}-dom-flat.json`), JSON.stringify(domTree, null, 2))
        } finally {
          await cdp.detach()
        }
      }

      const { snapshot } = await getAriaSnapshot({ page })
      expect(snapshot.length).toBeGreaterThan(0)
      // Check for locator format: attribute selector or role selector
      expect(snapshot).toMatch(/(?:\[id="|\[data-[\w-]+="|role=)/)
      const wrapperLines = snapshot.split('\n').filter((line) => {
        const trimmed = line.trim()
        return /^(generic|group|none|presentation)\s*:?$/.test(trimmed)
      })
      expect(wrapperLines).toEqual([])
      fs.writeFileSync(path.join(SNAPSHOTS_DIR, `${site.name}-raw.txt`), snapshot)
      console.log(`\n📊 ${site.name.toUpperCase()} snapshot size: ${snapshot.length} bytes`)

      const { snapshot: interactiveSnapshot } = await getAriaSnapshot({
        page,
        interactiveOnly: true,
      })
      expect(interactiveSnapshot).not.toMatch(/^\s*heading\b/m)
      // Check for locator format: attribute selector or role selector
      expect(interactiveSnapshot).toMatch(/(?:\[id="|\[data-[\w-]+="|role=)/)
      fs.writeFileSync(path.join(SNAPSHOTS_DIR, `${site.name}-interactive.txt`), interactiveSnapshot)
    }, 30000)
  }

  it('prosemirror editor - contenteditable appears in snapshot and is interactable', async () => {
    await page.goto('https://prosemirror.net/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)

    const { snapshot: interactiveSnapshot } = await getAriaSnapshot({ page, interactiveOnly: true })

    fs.writeFileSync(path.join(SNAPSHOTS_DIR, 'prosemirror-interactive.txt'), interactiveSnapshot)
    console.log('\n--- PROSEMIRROR INTERACTIVE SNAPSHOT ---')
    console.log(interactiveSnapshot)

    // The ProseMirror editor uses a bare <div contenteditable="true"> without role="textbox".
    // After the contenteditable promotion fix, it should appear as a textbox.
    expect(interactiveSnapshot).toContain('textbox')
    expect(interactiveSnapshot).toContain('[contenteditable="true"]')

    // The generated locator should actually work in Playwright
    const editor = page.locator('[contenteditable="true"]')
    const editorCount = await editor.count()
    expect(editorCount).toBe(1)

    // Click on the editor and type content
    await editor.click()
    // Select all existing content and replace it
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('Hello from playwriter test!')

    const content = await editor.innerText()
    expect(content).toContain('Hello from playwriter test!')

    // Take full snapshot again and verify the new content is visible
    const { snapshot: afterSnapshot } = await getAriaSnapshot({ page })
    expect(afterSnapshot).toContain('Hello from playwriter test')
  }, 30000)

  it('bare contenteditable without role=textbox shows in snapshot', async () => {
    // Reproduces the core issue: bare contenteditable divs (like ProseMirror uses)
    // have no explicit role="textbox", so Chrome's AX tree reports them as "generic".
    // Our fix promotes them to textbox.
    const htmlServer = await createHtmlServer({
      htmlByPath: {
        '/': `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ContentEditable Test</title></head>
<body>
  <h1>Rich Text Editor Test</h1>
  <div id="editor-with-id" contenteditable="true"
       style="border: 1px solid #ccc; padding: 8px; min-height: 60px;">
    <p>Editor with id, no role attribute.</p>
  </div>
  <div class="ProseMirror" contenteditable="true"
       style="border: 1px solid #ccc; padding: 8px; min-height: 60px;">
    <p>Bare ProseMirror-style editor, no role, no id.</p>
  </div>
  <div contenteditable=""
       style="border: 1px solid #ccc; padding: 8px; min-height: 60px;">
    <p>Editor with empty contenteditable attr.</p>
  </div>
  <div contenteditable="plaintext-only"
       style="border: 1px solid #ccc; padding: 8px; min-height: 60px;">
    <p>Plaintext-only editor.</p>
  </div>
  <div contenteditable="true" role="textbox" aria-label="Labeled editor"
       style="border: 1px solid #ccc; padding: 8px; min-height: 60px;">
    <p>Editor with explicit role=textbox.</p>
  </div>
  <input type="text" placeholder="Normal input" />
</body>
</html>`,
      },
    })

    try {
      await page.goto(htmlServer.baseUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(500)

      const { snapshot: interactiveSnapshot } = await getAriaSnapshot({ page, interactiveOnly: true })
      console.log('\n--- CONTENTEDITABLE INTERACTIVE SNAPSHOT ---')
      console.log(interactiveSnapshot)

      // All contenteditable divs should appear as textbox
      const textboxLines = interactiveSnapshot.split('\n').filter((line) => {
        return line.includes('textbox')
      })
      // 5 contenteditable (id, bare, empty-attr, plaintext-only, explicit-role) + 1 input = 6
      expect(textboxLines.length).toBeGreaterThanOrEqual(6)

      // The editor with id should use [id="editor-with-id"] as locator
      expect(interactiveSnapshot).toContain('[id="editor-with-id"]')

      // The bare contenteditable without id/role should use [contenteditable="true"]
      expect(interactiveSnapshot).toContain('[contenteditable="true"]')

      // Try clicking and typing in the bare contenteditable (no role, no id)
      const bareEditors = page.locator('[contenteditable="true"]')
      const bareCount = await bareEditors.count()
      expect(bareCount).toBeGreaterThanOrEqual(2) // at least the 2 bare ones

      // Click the first bare contenteditable and type
      await bareEditors.first().click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type('Typed via locator!')

      const content = await bareEditors.first().innerText()
      expect(content).toContain('Typed via locator!')
    } finally {
      await htmlServer.close()
    }
  }, 30000)

  it('returns the current accessibility tree after page and client-side navigation', async () => {
    const htmlServer = await createHtmlServer({
      htmlByPath: {
        '/first': '<main><h1>First route</h1></main>',
        '/second': '<main><h1>Second route</h1></main>',
        '/rendered': dedent`
          <main><h1>Previous route</h1></main>
          <script>
            requestAnimationFrame(() => requestAnimationFrame(() => {
              document.querySelector('h1').textContent = 'Rendered route'
            }))
          </script>
        `,
      },
    })

    try {
      await page.goto(`${htmlServer.baseUrl}/first`, { waitUntil: 'domcontentloaded' })
      const { snapshot: firstSnapshot } = await getAriaSnapshot({ page })
      expect(firstSnapshot).toContain('First route')

      await page.goto(`${htmlServer.baseUrl}/second`, { waitUntil: 'domcontentloaded' })
      expect(await page.locator('main').innerText()).toBe('Second route')

      const { snapshot: secondSnapshot } = await getAriaSnapshot({ page })
      expect(secondSnapshot).toContain('Second route')
      expect(secondSnapshot).not.toContain('First route')

      await page.evaluate(() => {
        document.defaultView!.history.pushState({}, '', '/third')
        document.querySelector('main')!.innerHTML = '<h1>Third route</h1>'
      })
      expect(await page.locator('main').innerText()).toBe('Third route')

      const { snapshot: thirdSnapshot } = await getAriaSnapshot({ page })
      expect(thirdSnapshot).toContain('Third route')
      expect(thirdSnapshot).not.toContain('Second route')

      await page.goto(`${htmlServer.baseUrl}/rendered`, { waitUntil: 'domcontentloaded' })
      const { snapshot: renderedSnapshot } = await getAriaSnapshot({ page })
      expect(await page.locator('main').innerText()).toBe('Rendered route')
      expect(renderedSnapshot).toContain('Rendered route')
      expect(renderedSnapshot).not.toContain('Previous route')
    } finally {
      await htmlServer.close()
    }
  }, 30000)

  it('generates a usable locator for CSS-transformed accessible text', async () => {
    const htmlServer = await createHtmlServer({
      htmlByPath: {
        '/': dedent`
          <!doctype html>
          <button style="text-transform: capitalize">jersey 150</button>
          <button>Save</button>
          <button>save</button>
        `,
      },
    })

    try {
      await page.goto(htmlServer.baseUrl, { waitUntil: 'domcontentloaded' })
      const { snapshot } = await getAriaSnapshot({ page, interactiveOnly: true })
      const locator = snapshot.match(/role=button\[name="[^"]+"i?\]/)?.[0]
      if (!locator) {
        throw new Error(`Snapshot did not contain a button locator: ${snapshot}`)
      }

      expect(await page.locator(locator).count()).toBe(1)
      const caseVariantLocators = snapshot.match(/role=button\[name="save"i\](?: >> nth=\d+)?/gi) ?? []
      expect(caseVariantLocators).toHaveLength(2)
      expect(
        await Promise.all(
          caseVariantLocators.map((selector) => {
            return page.locator(selector).count()
          }),
        ),
      ).toEqual([1, 1])
    } finally {
      await htmlServer.close()
    }
  }, 30000)

  // The toolbar is injected async after load, so snapshots used to flip between runs
  it('never includes the Playwriter toolbar', async () => {
    const htmlServer = await createHtmlServer({ htmlByPath: { '/': '<!doctype html><button>Save</button>' } })
    try {
      await page.goto(htmlServer.baseUrl, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-playwriter-toolbar]').first().waitFor({ state: 'attached' })
      const [full, interactive] = await Promise.all([
        getAriaSnapshot({ page }),
        getAriaSnapshot({ page, interactiveOnly: true }),
      ])
      expect(full.snapshot).toMatchInlineSnapshot(`" role=button[name="Save"i]"`)
      expect(interactive.snapshot).toMatchInlineSnapshot(`" role=button[name="Save"i]"`)
    } finally {
      await htmlServer.close()
    }
  }, 30000)

  it('keeps snapshot of focusable containers the same when they take focus', async () => {
    const html = `<!doctype html>
      <div id="plain" tabindex="0"><span>Flow alpha</span> <button>Edit</button></div>
      <div id="titled" tabindex="0" title="Tooltip"><span>Hint text</span> <button>Act</button></div>`
    const htmlServer = await createHtmlServer({ htmlByPath: { '/': html } })
    try {
      await page.goto(htmlServer.baseUrl, { waitUntil: 'domcontentloaded' })
      const unfocused = (await getAriaSnapshot({ page })).snapshot
      expect(unfocused).toContain('text: "Flow alpha"')
      expect(unfocused).toContain('generic "Tooltip":')
      for (const id of ['plain', 'titled']) {
        await page.locator(`#${id}`).focus()
        expect((await getAriaSnapshot({ page })).snapshot).toBe(unfocused)
      }
    } finally {
      await htmlServer.close()
    }
  }, 30000)

  it('resolves refs to the same locator as their snapshot line', async () => {
    const html = `<!doctype html><button>Save</button><section aria-label="Panel"><button>Save</button></section>`
    const htmlServer = await createHtmlServer({ htmlByPath: { '/': html } })
    try {
      await page.goto(htmlServer.baseUrl, { waitUntil: 'domcontentloaded' })
      const scoped = await getAriaSnapshot({ page, locator: page.getByRole('region', { name: 'Panel' }) })
      const selectors = scoped.refs.map((entry) => scoped.getSelectorForRef(entry.ref))
      expect(selectors).toEqual(['role=button[name="Save"i] >> nth=1'])
      expect(await page.locator(selectors[0]!).count()).toBe(1)
    } finally {
      await htmlServer.close()
    }
  }, 30000)

  it('gives file inputs locators that Playwright resolves to the same input', async () => {
    const inputs = {
      plain: '<input type="file">',
      title: '<input type="file" title="Upload avatar">',
      labelledby: '<span id="lb">Report file</span><input type="file" aria-labelledby="lb">',
      placeholder: '<input type="file" placeholder="Pick one">',
      multiple: '<input type="file" multiple>',
      directory: '<input type="file" webkitdirectory>',
      label: '<label>Avatar <input type="file"></label>',
    }
    const html = `<!doctype html>${Object.entries(inputs)
      .map(([name, input]) => `<section aria-label="${name}">${input}</section>`)
      .join('')}`
    const htmlServer = await createHtmlServer({ htmlByPath: { '/': html } })
    try {
      await page.goto(htmlServer.baseUrl, { waitUntil: 'domcontentloaded' })
      const result = await getAriaSnapshot({ page })
      const resolved = await Promise.all(
        result.refs.map(async (entry) => {
          const target = page.locator(result.getSelectorForRef(entry.ref)!)
          expect(await target.count()).toBe(1)
          return target.evaluate((element) => element.closest('section')?.getAttribute('aria-label'))
        }),
      )
      expect(resolved).toEqual(Object.keys(inputs))
    } finally {
      await htmlServer.close()
    }
  }, 30000)

  it('anchors repeated locators to a uniquely named ancestor when asked', async () => {
    const html = `<!doctype html><ul>
      <li aria-label="Row A"><button>Edit</button></li>
      <li aria-label="Row B"><button>Edit</button></li>
      <li aria-label="Row C"><button>Edit</button><button>Edit</button></li>
    </ul>`
    const htmlServer = await createHtmlServer({ htmlByPath: { '/': html } })
    try {
      await page.goto(htmlServer.baseUrl, { waitUntil: 'domcontentloaded' })
      const anchored = await getAriaSnapshot({ page, duplicateLocator: 'ancestor' })
      const locators = anchored.refs.map((entry) => anchored.getSelectorForRef(entry.ref) ?? '')
      expect(locators).toEqual([
        'role=listitem[name="Row A"i] >> role=button[name="Edit"i]',
        'role=listitem[name="Row B"i] >> role=button[name="Edit"i]',
        'role=button[name="Edit"i] >> nth=2',
        'role=button[name="Edit"i] >> nth=3',
      ])
      const rows = await Promise.all(
        locators.map(async (locator) => {
          const target = page.locator(locator)
          expect(await target.count()).toBe(1)
          return target.evaluate((element) => element.closest('li')?.getAttribute('aria-label'))
        }),
      )
      expect(rows).toEqual(['Row A', 'Row B', 'Row C', 'Row C'])

      const bracketed = await getAriaSnapshot({ page, duplicateLocator: 'ancestor-bracketed' })
      const editLines = bracketed.snapshot.split('\n').filter((line) => line.includes('Edit'))
      expect(editLines.map((line) => line.trim())).toEqual([
        'button "Edit" [role=listitem[name="Row A"i] >> role=button[name="Edit"i]]',
        'button "Edit" [role=listitem[name="Row B"i] >> role=button[name="Edit"i]]',
        'role=button[name="Edit"i] >> nth=2',
        'role=button[name="Edit"i] >> nth=3',
      ])
    } finally {
      await htmlServer.close()
    }
  }, 30000)

  it('keeps ancestor anchors on DOM descendants when aria-owns or slots move AX children', async () => {
    const html = `<!doctype html>
      <div role="group" aria-label="Panel" aria-owns="owned"></div>
      <div id="owned"><button>Edit</button></div>
      <slot-host><button>Edit</button></slot-host>
      <button>Edit</button>
      <script>
        customElements.define('slot-host', class extends HTMLElement {
          connectedCallback() {
            this.attachShadow({ mode: 'open' }).innerHTML = '<div role="group" aria-label="Slotted"><slot></slot></div>'
          }
        })
      </script>`
    const htmlServer = await createHtmlServer({ htmlByPath: { '/': html } })
    try {
      await page.goto(htmlServer.baseUrl, { waitUntil: 'domcontentloaded' })
      const byNth = await getAriaSnapshot({ page })
      const anchored = await getAriaSnapshot({ page, duplicateLocator: 'ancestor' })
      expect(anchored.refs.length).toBe(byNth.refs.length)
      for (const [index, entry] of anchored.refs.entries()) {
        const target = page.locator(anchored.getSelectorForRef(entry.ref) ?? '')
        expect(await target.count()).toBe(1)
        const expected = await page.locator(byNth.getSelectorForRef(byNth.refs[index]!.ref) ?? '').elementHandle()
        expect(await target.evaluate((element, other) => element === other, expected)).toBe(true)
      }
    } finally {
      await htmlServer.close()
    }
  }, 30000)

  it('numbers role locators like Playwright when open shadow DOM comes first', async () => {
    const html = `<!doctype html><div id="host"></div><button data-where="light">Save</button>
      <script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<button data-where="shadow">Save</button>'</script>`
    const htmlServer = await createHtmlServer({ htmlByPath: { '/': html } })
    try {
      await page.goto(htmlServer.baseUrl, { waitUntil: 'domcontentloaded' })
      const { snapshot } = await getAriaSnapshot({ page })
      const locators = snapshot
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('role=button'))
      expect(locators).toEqual(['role=button[name="Save"i] >> nth=1', 'role=button[name="Save"i] >> nth=0'])
      const targets = await Promise.all(locators.map((locator) => page.locator(locator).getAttribute('data-where')))
      expect(targets).toEqual(['shadow', 'light'])
    } finally {
      await htmlServer.close()
    }
  }, 30000)

  it('scopes snapshot to cross-origin iframe locator', async () => {
    const iframeServer = await createHtmlServer({
      htmlByPath: {
        '/iframe.html': `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Iframe Content</title>
  </head>
  <body>
    <h1>Iframe Heading</h1>
    <button data-testid="iframe-button">Iframe Button</button>
  </body>
</html>`,
      },
    })

    const outerServer = await createHtmlServer({
      htmlByPath: {
        '/': `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Outer Page</title>
  </head>
  <body>
    <h1>Outer Heading</h1>
    <iframe data-testid="external-iframe" src="${iframeServer.baseUrl}/iframe.html"></iframe>
  </body>
</html>`,
      },
    })

    try {
      await page.goto(outerServer.baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 })
      await page.locator('[data-testid="external-iframe"]').waitFor({ timeout: 5000 })
      await page
        .frameLocator('[data-testid="external-iframe"]')
        .locator('[data-testid="iframe-button"]')
        .waitFor({ timeout: 5000 })

      // Convert iframe Locator to Frame
      const iframeHandle = await page.locator('[data-testid="external-iframe"]').elementHandle()
      const iframeFrame = await iframeHandle!.contentFrame()

      const { snapshot } = await getAriaSnapshot({
        page,
        frame: iframeFrame!,
      })

      expect(snapshot).toContain('Iframe Heading')
      // TODO we seem to be using name with higher priority than test id for some reason in snapshots
      // expect(snapshot).toContain('[data-testid="iframe-button"]')
      expect(snapshot).not.toContain('Outer Heading')
    } finally {
      await outerServer.close()
      await iframeServer.close()
    }
  }, 30000)
})
