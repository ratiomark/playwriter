import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from '@xmorse/playwright-core'
import { getCdpUrl } from './utils.js'
import { getCDPSessionForPage } from './cdp-session.js'
import { Debugger } from './debugger.js'
import { Editor } from './editor.js'
import { PlaywrightExecutor } from './executor.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import dedent from 'string-dedent'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  createSseServer,
  safeCloseCDPBrowser,
  type TestContext,
  withTimeout,
  js,
} from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19993

// --- CDP Session Tests ---

describe('CDP Session Tests', () => {
  let testCtx: TestContext | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-cdp-test-', toggleExtension: true })

    const serviceWorker = await getExtensionServiceWorker(testCtx.browserContext)
    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })
    await new Promise((r) => setTimeout(r, 100))
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx)
    testCtx = null
  })

  const getBrowserContext = () => {
    if (!testCtx?.browserContext) throw new Error('Browser not initialized')
    return testCtx.browserContext
  }

  it('should use Debugger class to set breakpoints and inspect variables', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    const testUrl = 'https://example.com/?test=debugger-variables'
    await page.goto(testUrl)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page })
    const dbg = new Debugger({ cdp: cdpSession })

    await dbg.enable()

    expect(dbg.isPaused()).toBe(false)

    const pausedPromise = new Promise<void>((resolve) => {
      cdpSession.on('Debugger.paused', () => {
        resolve()
      })
    })

    const evalPromise = cdpSession.send('Runtime.evaluate', {
      expression: `(function testFunction() {
                const localVar = 'hello';
                const numberVar = 42;
                debugger;
                return localVar + numberVar;
            })()`,
    })

    await Promise.race([
      pausedPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Debugger.paused timeout')), 5000)),
    ])

    expect(dbg.isPaused()).toBe(true)

    const location = await dbg.getLocation()
    expect(location.callstack[0].functionName).toBe('testFunction')
    expect(location.sourceContext).toContain('debugger')

    const vars = await dbg.inspectLocalVariables()
    expect(vars).toMatchInlineSnapshot(`
          {
            "localVar": "hello",
            "numberVar": 42,
          }
        `)

    const evalResult = await dbg.evaluate({ expression: 'localVar + " world"' })
    expect(evalResult.value).toBe('hello world')

    await dbg.resume()
    await new Promise((r) => setTimeout(r, 100))
    expect(dbg.isPaused()).toBe(false)
    await evalPromise

    await cdpSession.detach()
    await page.close()
  }, 60000)

  it('should reuse cached CDP session and close on page close', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    const testUrl = 'https://example.com/?test=debugger-step'
    await page.goto(testUrl)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const executor = new PlaywrightExecutor({
      cdpConfig: { port: TEST_PORT },
      logger: {
        log: () => {},
        error: () => {},
      },
    })

    const result = await executor.execute(js`
            const target = context.pages().findLast((p) => p.url().includes('debugger-step'))
            const sessionA = await getCDPSession({ page: target })
            const sessionB = await getCDPSession({ page: target })
            await sessionA.send('Runtime.evaluate', { expression: '1 + 1', returnByValue: true })
            const evalResult = await sessionB.send('Runtime.evaluate', { expression: '2 + 2', returnByValue: true })
            return evalResult.result.value
        `)

    expect(result.isError).toBe(false)
    expect(result.text).toContain('[return value] 4')

    await page.close()
  }, 60000)

  it('should import local ESM modules from the session cwd', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'playwriter-local-import-'))
    fs.writeFileSync(
      path.join(cwd, 'page-info.mjs'),
      dedent`
        import path from 'node:path'

        export async function getPageInfo({ page }) {
          return { titleType: typeof await page.title(), file: path.basename('/tmp/helper.mjs') }
        }
      `,
    )
    const executor = new PlaywrightExecutor({
      cdpConfig: { port: TEST_PORT },
      cwd,
      logger: {
        log: () => {},
        error: () => {},
      },
    })

    const result = await executor.execute(js`
      const { getPageInfo } = await import('./page-info.mjs')
      const page = await context.newPage()
      try {
        return await getPageInfo({ page })
      } finally {
        await page.close()
      }
    `)

    expect(result).toMatchObject({
      isError: false,
      text: "[return value] { titleType: 'string', file: 'helper.mjs' }",
    })
  }, 60000)

  it('should list scripts with Debugger class', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    // Use setContent with external script URLs so Debugger.listScripts returns them
    const page = await browserContext.newPage()
    await page.setContent(`
      <html>
        <head>
          <title>script-list-test</title>
          <script src="data:text/javascript,function hello() { return 1; }"></script>
          <script src="data:text/javascript,function world() { return 2; }"></script>
        </head>
        <body><h1>Script test</h1></body>
      </html>
    `)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPages = browser.contexts()[0].pages()
    const cdpPage = (
      await Promise.all(
        cdpPages.map(async (candidate) => {
          return { candidate, title: await candidate.title() }
        }),
      )
    ).find((entry) => entry.title === 'script-list-test')?.candidate
    expect(cdpPage).toBeDefined()

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page: cdpPage! })
    const dbg = new Debugger({ cdp: cdpSession })

    await dbg.enable()

    const scripts = await dbg.listScripts()
    expect(scripts.length).toBeGreaterThan(0)
    expect(scripts[0]).toHaveProperty('scriptId')
    expect(scripts[0]).toHaveProperty('url')

    await cdpSession.detach()
    await browser.close()
    await page.close()
  }, 60000)

  it('should manage breakpoints with Debugger class', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.setContent(`
            <html>
                <head>
                    <script src="data:text/javascript,function testFunc() { return 42; }"></script>
                </head>
                <body></body>
            </html>
        `)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page })
    const dbg = new Debugger({ cdp: cdpSession })

    await dbg.enable()

    expect(dbg.listBreakpoints()).toHaveLength(0)

    const bpId = await dbg.setBreakpoint({ file: 'https://example.com/test.js', line: 1 })
    expect(typeof bpId).toBe('string')
    expect(dbg.listBreakpoints()).toHaveLength(1)
    expect(dbg.listBreakpoints()[0]).toMatchObject({
      id: bpId,
      file: 'https://example.com/test.js',
      line: 1,
    })

    await dbg.deleteBreakpoint({ breakpointId: bpId })
    expect(dbg.listBreakpoints()).toHaveLength(0)

    await cdpSession.detach()
    await page.close()
  }, 60000)

  it('should step through code with Debugger class', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://example.com/')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page })
    const dbg = new Debugger({ cdp: cdpSession })

    await dbg.enable()

    const pausedPromise = new Promise<void>((resolve) => {
      cdpSession.on('Debugger.paused', () => resolve())
    })

    const evalPromise = cdpSession.send('Runtime.evaluate', {
      expression: `(function outer() {
                function inner() {
                    const x = 1;
                    debugger;
                    const y = 2;
                    return x + y;
                }
                const result = inner();
                return result;
            })()`,
    })

    await pausedPromise
    expect(dbg.isPaused()).toBe(true)

    const location1 = await dbg.getLocation()
    expect(location1.callstack.length).toBeGreaterThanOrEqual(2)
    expect(location1.callstack[0].functionName).toBe('inner')
    expect(location1.callstack[1].functionName).toBe('outer')

    const stepOverPromise = new Promise<void>((resolve) => {
      cdpSession.on('Debugger.paused', () => resolve())
    })
    await dbg.stepOver()
    await stepOverPromise

    const location2 = await dbg.getLocation()
    expect(location2.lineNumber).toBeGreaterThan(location1.lineNumber)

    const stepOutPromise = new Promise<void>((resolve) => {
      cdpSession.on('Debugger.paused', () => resolve())
    })
    await dbg.stepOut()
    await stepOutPromise

    const location3 = await dbg.getLocation()
    expect(location3.callstack[0].functionName).toBe('outer')

    await dbg.resume()
    await evalPromise

    await cdpSession.detach()
    await page.close()
  }, 60000)

  it('should profile JavaScript execution using CDP Profiler', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    const testUrl = 'https://example.com/?test=debugger-profiler'
    await page.goto(testUrl)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page })
    await cdpSession.send('Profiler.enable')
    await cdpSession.send('Profiler.start')

    await cdpSession.send('Runtime.evaluate', {
      expression: `(() => {
                function fibonacci(n) {
                    if (n <= 1) return n
                    return fibonacci(n - 1) + fibonacci(n - 2)
                }
                for (let i = 0; i < 5; i++) {
                    fibonacci(20)
                }
                for (let i = 0; i < 1000; i++) {
                    document.querySelectorAll('*')
                }
            })()`,
    })

    const stopResult = await cdpSession.send('Profiler.stop')
    const profile = stopResult.profile

    const functionNames = profile.nodes
      .map((n) => n.callFrame.functionName)
      .filter((name) => name && name.length > 0)
      .slice(0, 10)

    expect(profile.nodes.length).toBeGreaterThan(0)
    expect(profile.endTime - profile.startTime).toBeGreaterThan(0)
    expect(functionNames.every((name) => typeof name === 'string')).toBe(true)

    await cdpSession.send('Profiler.disable')
    await cdpSession.detach()
    await page.close()
  }, 60000)

  it('should update Target.getTargets URL after page navigation', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })

    const page = await browserContext.newPage()
    await page.goto('https://example.com/')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('example.com'))
    expect(cdpPage).toBeDefined()

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page: cdpPage! })

    const initialTargets = await cdpSession.send('Target.getTargets')
    const initialPageTarget = initialTargets.targetInfos.find((t) => t.type === 'page' && t.url.includes('example.com'))
    expect(initialPageTarget?.url).toBe('https://example.com/')

    await cdpPage!.goto('https://example.org/', { waitUntil: 'domcontentloaded' })
    await new Promise((r) => setTimeout(r, 100))

    const afterNavTargets = await cdpSession.send('Target.getTargets')
    const allPageTargets = afterNavTargets.targetInfos.filter((t) => t.type === 'page')

    const aboutBlankTargets = allPageTargets.filter((t) => t.url === 'about:blank')
    expect(aboutBlankTargets).toHaveLength(0)

    const exampleComTargets = allPageTargets.filter((t) => t.url.includes('example.com'))
    expect(exampleComTargets).toHaveLength(0)

    const exampleOrgTargets = allPageTargets.filter((t) => t.url.includes('example.org'))
    expect(exampleOrgTargets).toHaveLength(1)

    await cdpSession.detach()
    await browser.close()
    await page.close()
  }, 60000)

  it('should not break a pending evaluate when a second client connects', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })

    const page = await browserContext.newPage()
    await page.goto('https://example.com/?test=shared-evaluate')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const browserA = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const pageA = browserA
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('shared-evaluate'))
    expect(pageA).toBeDefined()

    const pending = pageA!.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 2000))
      return 'done'
    })
    const pendingResult = pending.then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.message.split('\n')[0] }),
    )
    await new Promise((r) => setTimeout(r, 200))

    const browserB = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))

    expect(await pendingResult).toEqual({ value: 'done' })
    expect(await pageA!.evaluate(() => 1 + 1)).toBe(2)

    await safeCloseCDPBrowser(browserB)
    await safeCloseCDPBrowser(browserA)
    await page.close()
  }, 60000)

  it('should return correct targets for multiple pages via Target.getTargets', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })

    const page1 = await browserContext.newPage()
    await page1.goto('https://example.com/')
    await page1.bringToFront()
    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    const page2 = await browserContext.newPage()
    await page2.goto('https://example.org/')
    await page2.bringToFront()
    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('example.com'))
    expect(cdpPage).toBeDefined()

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page: cdpPage! })

    const { targetInfos } = await cdpSession.send('Target.getTargets')
    const allPageTargets = targetInfos.filter((t) => t.type === 'page')

    const aboutBlankTargets = allPageTargets.filter((t) => t.url === 'about:blank')
    expect(aboutBlankTargets).toHaveLength(0)

    const pageTargets = allPageTargets
      .map((t) => ({ type: t.type, url: t.url }))
      .sort((a, b) => a.url.localeCompare(b.url))

    expect(pageTargets).toMatchInlineSnapshot(`
          [
            {
              "type": "page",
              "url": "https://example.com/",
            },
            {
              "type": "page",
              "url": "https://example.org/",
            },
          ]
        `)

    await cdpSession.detach()
    await browser.close()
    await page1.close()
    await page2.close()
  }, 60000)

  it('should reject an explicit stale target instead of returning another target', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })

    const page = await browserContext.newPage()
    await page.goto('https://example.com/')
    await page.bringToFront()
    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const connectedPage = browser
      .contexts()[0]
      .pages()
      .find((candidatePage) => {
        return candidatePage.url() === 'https://example.com/'
      })
    expect(connectedPage).toBeDefined()

    const cdpSession = await getCDPSessionForPage({ page: connectedPage! })
    await expect(cdpSession.send('Target.getTargetInfo', { targetId: 'stale-target-id' })).rejects.toThrow(
      'Target not found: stale-target-id',
    )

    await cdpSession.detach()
    await browser.close()
    await page.close()
  }, 60000)

  it('should create CDP session for page after navigation', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://example.com/')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    await page.goto('https://example.org/', { waitUntil: 'domcontentloaded' })
    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('example.org'))
    expect(cdpPage).toBeDefined()

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page: cdpPage! })

    const evalResult = await cdpSession.send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    })
    expect(evalResult.result.value).toContain('Example Domain')

    await cdpSession.detach()
    await browser.close()
    await page.close()
  }, 60000)

  it('should maintain CDP session functionality after page URL change', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    const initialUrl = 'https://example.com/'
    await page.goto(initialUrl)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('example.com'))
    expect(cdpPage).toBeDefined()

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page: cdpPage! })

    const initialEvalResult = await cdpSession.send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    })
    expect(initialEvalResult.result.value).toBe('Example Domain')

    const newUrl = 'https://example.org/'
    await cdpPage!.goto(newUrl, { waitUntil: 'domcontentloaded' })

    expect(cdpPage!.url()).toBe(newUrl)

    const layoutMetrics = await cdpSession.send('Page.getLayoutMetrics')
    expect(layoutMetrics.cssVisualViewport).toBeDefined()
    expect(layoutMetrics.cssVisualViewport.clientWidth).toBeGreaterThan(0)

    const afterNavEvalResult = await cdpSession.send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    })
    expect(afterNavEvalResult.result.value).toContain('Example Domain')

    const locationResult = await cdpSession.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    })
    expect(locationResult.result.value).toBe(newUrl)

    await cdpSession.detach()
    await browser.close()
    await page.close()
  }, 60000)

  it('should pause on all exceptions with setPauseOnExceptions', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://example.com/')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('example.com'))
    expect(cdpPage).toBeDefined()

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page: cdpPage! })
    const dbg = new Debugger({ cdp: cdpSession })

    await dbg.enable()
    await dbg.setPauseOnExceptions({ state: 'all' })

    const pausedPromise = new Promise<void>((resolve) => {
      cdpSession.on('Debugger.paused', () => resolve())
    })

    const evalPromise = cdpSession.send('Runtime.evaluate', {
      expression: `(function() {
                try {
                    throw new Error('Caught test error');
                } catch (e) {
                    // caught but should still pause with state 'all'
                }
            })()`,
    })

    await Promise.race([
      pausedPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Debugger.paused timeout')), 5000)),
    ])

    expect(dbg.isPaused()).toBe(true)

    const location = await dbg.getLocation()
    expect(location.sourceContext).toContain('throw')

    await dbg.resume()
    await evalPromise

    await dbg.setPauseOnExceptions({ state: 'none' })

    await cdpSession.detach()
    await browser.close()
    await page.close()
  }, 60000)

  it('should inspect local and global variables with inline snapshots', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.setContent(`
            <html>
                <head>
                    <script>
                        const GLOBAL_CONFIG = 'production';
                        function runTest() {
                            const userName = 'Alice';
                            const userAge = 25;
                            const settings = { theme: 'dark', lang: 'en' };
                            const scores = [10, 20, 30];
                            debugger;
                            return userName;
                        }
                    </script>
                </head>
                <body>
                    <button onclick="runTest()">Run</button>
                </body>
            </html>
        `)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    let cdpPage
    for (const p of browser.contexts()[0].pages()) {
      const html = await p.content()
      if (html.includes('runTest')) {
        cdpPage = p
        break
      }
    }
    expect(cdpPage).toBeDefined()

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page: cdpPage! })
    const dbg = new Debugger({ cdp: cdpSession })

    await dbg.enable()

    const globalVars = await dbg.inspectGlobalVariables()
    expect(globalVars).toMatchInlineSnapshot(`
          [
            "GLOBAL_CONFIG",
          ]
        `)

    const pausedPromise = new Promise<void>((resolve) => {
      cdpSession.on('Debugger.paused', () => resolve())
    })

    // Don't await - we want it to pause at breakpoint
    const evalPromise = cdpPage!.evaluate('runTest()').catch(() => {
      // Ignore errors from evaluate when browser closes
    })

    await pausedPromise
    expect(dbg.isPaused()).toBe(true)

    const localVars = await dbg.inspectLocalVariables()
    expect(localVars).toMatchInlineSnapshot(`
          {
            "GLOBAL_CONFIG": "production",
            "scores": "[array]",
            "settings": "[object]",
            "userAge": 25,
            "userName": "Alice",
          }
        `)

    await dbg.resume()
    // Wait for evaluate to complete after resume
    await evalPromise

    await cdpSession.detach()
    await browser.close()
    await page.close()
  }, 60000)

  it('should click at correct coordinates on high-DPI simulation', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://example.com/')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('example.com'))
    expect(cdpPage).toBeDefined()

    // example.com no longer has an h1, so add our own click target
    await cdpPage!.evaluate(() => {
      const heading = document.createElement('h1')
      heading.textContent = 'Click target'
      document.body.prepend(heading)
    })
    const h1Bounds = await cdpPage!.locator('h1').boundingBox()
    expect(h1Bounds).toBeDefined()
    console.log('H1 bounding box:', h1Bounds)

    await cdpPage!.evaluate(() => {
      ;(window as any).clickedAt = null
      document.addEventListener('click', (e) => {
        ;(window as any).clickedAt = { x: e.clientX, y: e.clientY }
      })
    })

    await cdpPage!.locator('h1').click()

    const clickedAt = await cdpPage!.evaluate(() => (window as any).clickedAt)
    console.log('Clicked at:', clickedAt)

    expect(clickedAt).toBeDefined()
    expect(clickedAt.x).toBeGreaterThan(0)
    expect(clickedAt.y).toBeGreaterThan(0)

    await browser.close()
    await page.close()
  }, 60000)

  it('should use Editor class to list, read, and edit scripts', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://example.com/')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('example.com'))
    expect(cdpPage).toBeDefined()

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page: cdpPage! })
    const editor = new Editor({ cdp: cdpSession })

    await editor.enable()

    await cdpPage!.addScriptTag({
      content: `
                function greetUser(name) {
                    console.log('Hello, ' + name);
                    return 'Hello, ' + name;
                }
            `,
    })
    await new Promise((r) => setTimeout(r, 100))
    const scripts = await editor.list()
    expect(scripts.length).toBeGreaterThan(0)

    const matches = await editor.grep({ regex: /greetUser/ })
    expect(matches.length).toBeGreaterThan(0)

    const match = matches[0]
    const { content, totalLines } = await editor.read({ url: match.url })
    expect(content).toContain('greetUser')
    expect(totalLines).toBeGreaterThan(0)

    await editor.edit({
      url: match.url,
      oldString: "console.log('Hello, ' + name);",
      newString: "console.log('Hello, ' + name); console.log('EDITOR_TEST_MARKER');",
    })

    const consoleLogs: string[] = []
    cdpPage!.on('console', (msg) => {
      consoleLogs.push(msg.text())
    })

    await cdpPage!.evaluate(() => {
      ;(window as any).greetUser('World')
    })
    await new Promise((r) => setTimeout(r, 100))

    expect(consoleLogs).toContain('Hello, World')
    expect(consoleLogs).toContain('EDITOR_TEST_MARKER')

    await cdpSession.detach()
    await browser.close()
    await page.close()
  }, 60000)

  it('editor can list, read, and edit CSS stylesheets', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://example.com/')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('example.com'))
    expect(cdpPage).toBeDefined()

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page: cdpPage! })
    const editor = new Editor({ cdp: cdpSession })

    await editor.enable()

    await cdpPage!.addStyleTag({
      content: `
                .editor-test-element {
                    color: rgb(255, 0, 0);
                    background-color: rgb(0, 0, 255);
                }
            `,
    })
    await new Promise((r) => setTimeout(r, 100))
    const stylesheets = await editor.list({ pattern: /inline-css:/ })
    expect(stylesheets.length).toBeGreaterThan(0)

    const cssMatches = await editor.grep({ regex: /editor-test-element/, pattern: /inline-css:/ })
    expect(cssMatches.length).toBeGreaterThan(0)

    const cssMatch = cssMatches[0]
    const { content, totalLines } = await editor.read({ url: cssMatch.url })
    expect(content).toContain('editor-test-element')
    expect(content).toContain('rgb(255, 0, 0)')
    expect(totalLines).toBeGreaterThan(0)

    await cdpPage!.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'editor-test-element'
      el.id = 'test-div'
      el.textContent = 'Test'
      document.body.appendChild(el)
    })

    const colorBefore = await cdpPage!.evaluate(() => {
      const el = document.getElementById('test-div')!
      return window.getComputedStyle(el).color
    })
    expect(colorBefore).toBe('rgb(255, 0, 0)')

    await editor.edit({
      url: cssMatch.url,
      oldString: 'color: rgb(255, 0, 0);',
      newString: 'color: rgb(0, 255, 0);',
    })

    const colorAfter = await cdpPage!.evaluate(() => {
      const el = document.getElementById('test-div')!
      return window.getComputedStyle(el).color
    })
    expect(colorAfter).toBe('rgb(0, 255, 0)')

    await cdpSession.detach()
    await browser.close()
    await page.close()
  }, 60000)

  it('should inject bippy and find React fiber with getReactSource', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.setContent(`
            <!DOCTYPE html>
            <html>
            <head>
                <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
                <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
            </head>
            <body>
                <div id="root"></div>
                <script>
                    function SaveButton(props) {
                        return React.createElement('button', { id: 'react-btn' }, props.label);
                    }
                    function Panel() {
                        return React.createElement('section', null, React.createElement(SaveButton, {
                          label: 'Click me',
                          count: 3,
                          config: { variant: 'primary' },
                          onClick: () => {}
                        }));
                    }
                    function App() {
                        return React.createElement(Panel);
                    }
                    const root = ReactDOM.createRoot(document.getElementById('root'));
                    root.render(React.createElement(App));
                </script>
                <button id="plain-btn">Plain</button>
            </body>
            </html>
        `)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 500))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const pages = browser.contexts()[0].pages()
    const cdpPage = pages.find((p) => p.url().startsWith('about:'))
    expect(cdpPage).toBeDefined()

    const btn = cdpPage!.locator('#react-btn')
    const btnCount = await btn.count()
    expect(btnCount).toBe(1)

    const hasBippyBefore = await cdpPage!.evaluate(() => !!globalThis.__bippy)
    expect(hasBippyBefore).toBe(false)

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page: cdpPage! })

    const { getReactSource, getReactComponentInfo } = await import('./react-source.js')
    const source = await getReactSource({ locator: btn, cdp: cdpSession })
    const info = await getReactComponentInfo({ locator: btn, cdp: cdpSession })
    const plainInfo = await getReactComponentInfo({ locator: cdpPage!.locator('#plain-btn'), cdp: cdpSession })

    const hasBippyAfter = await cdpPage!.evaluate(() => !!globalThis.__bippy)
    expect(hasBippyAfter).toBe(true)

    const hasFiber = await btn.evaluate((el) => {
      const bippy = globalThis.__bippy
      if (!bippy) return false
      const fiber = bippy.getFiberFromHostInstance(el)
      return !!fiber
    })
    expect(hasFiber).toBe(true)

    const componentName = await btn.evaluate((el) => {
      const bippy = globalThis.__bippy
      if (!bippy) return null
      const fiber = bippy.getFiberFromHostInstance(el)
      let current = fiber
      while (current) {
        if (bippy.isCompositeFiber(current)) {
          return bippy.getDisplayName(current.type)
        }
        current = current.return ?? null
      }
      return null
    })
    expect(componentName).toBe('SaveButton')
    expect(plainInfo).toBe(null)
    expect(info?.componentName).toBe('SaveButton')
    expect(info?.hierarchy.map((item) => item.componentName)).toEqual(['SaveButton', 'Panel', 'App'])
    expect(info?.props).toEqual({
      label: 'Click me',
      count: 3,
      config: { variant: 'primary' },
      onClick: '[function]',
    })

    console.log('Component name from fiber:', componentName)
    console.log('React component info:', info)
    console.log('Source location (null for UMD React, works on local dev servers with JSX transform):', source)

    await browser.close()
    await page.close()
  }, 60000)
})

// --- Service Worker Target Tests ---

describe('Service Worker Target Tests', () => {
  let testCtx: TestContext | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-sw-test-', toggleExtension: true })
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx)
    testCtx = null
  })

  const getBrowserContext = () => {
    if (!testCtx?.browserContext) throw new Error('Browser not initialized')
    return testCtx.browserContext
  }

  it('should not expose service worker targets to Playwright (issue #14)', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://web.dev/', { waitUntil: 'load' })
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 500))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const context = browser.contexts()[0]

    const pages = context.pages()

    for (const p of pages) {
      const url = p.url()
      console.log('Page URL:', url)
      expect(url).not.toMatch(/sw\.js$/i)
      expect(url).not.toMatch(/service.?worker/i)
    }

    const targetPage = pages.find((p) => p.url().includes('web.dev'))
    expect(targetPage).toBeDefined()

    const title = await targetPage!.title()
    expect(title).toBeTruthy()

    await safeCloseCDPBrowser(browser)
    await page.close()
  }, 60000)

  it('should allow reading response bodies after re-enabling Network buffering', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://example.com/')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('example.com'))
    expect(cdpPage).toBeDefined()

    const wsUrl = getCdpUrl({ port: TEST_PORT })
    const cdpSession = await getCDPSessionForPage({ page: cdpPage! })

    await cdpSession.send('Network.disable')
    await cdpSession.send('Network.enable', {
      maxTotalBufferSize: 10000000,
      maxResourceBufferSize: 5000000,
    })

    const [response] = await Promise.all([
      cdpPage!.waitForResponse((resp) => resp.url() === 'https://example.com/'),
      cdpPage!.goto('https://example.com/'),
    ])

    const body = await response.text()

    expect(body).toBeDefined()
    expect(body).toContain('Example Domain')
    expect(body).toContain('</html>')

    await cdpSession.detach()
    await browser.close()
    await page.close()
  }, 60000)

  it('should stream SSE without waiting for response end', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await withTimeout({
      promise: getExtensionServiceWorker(browserContext),
      timeoutMs: 5000,
      errorMessage: 'getExtensionServiceWorker timed out',
    })
    const sseServer = await withTimeout({
      promise: createSseServer(),
      timeoutMs: 5000,
      errorMessage: 'createSseServer timed out',
    })
    let page: Awaited<ReturnType<typeof browserContext.newPage>> | null = null
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null

    try {
      page = await withTimeout({
        promise: browserContext.newPage(),
        timeoutMs: 5000,
        errorMessage: 'newPage timed out',
      })
      await withTimeout({
        promise: page.goto(`${sseServer.baseUrl}/`),
        timeoutMs: 5000,
        errorMessage: 'page.goto timed out',
      })
      await page.bringToFront()

      await withTimeout({
        promise: serviceWorker.evaluate(async () => {
          await globalThis.toggleExtensionForActiveTab()
        }),
        timeoutMs: 5000,
        errorMessage: 'toggleExtensionForActiveTab timed out',
      })
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })

      browser = await withTimeout({
        promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
        timeoutMs: 5000,
        errorMessage: 'connectOverCDP timed out',
      })
      const cdpPage = browser
        .contexts()[0]
        .pages()
        .find((p) => {
          return p.url().startsWith(sseServer.baseUrl)
        })
      expect(cdpPage).toBeDefined()

      await cdpPage!.evaluate(() => {
        return window.startSse()
      })
      await withTimeout({
        promise: cdpPage!.waitForFunction(
          () => {
            return window.__sseMessages.length > 0
          },
          { timeout: 5000 },
        ),
        timeoutMs: 7000,
        errorMessage: 'SSE message not received in time',
      })

      const firstMessage = await cdpPage!.evaluate(() => {
        return window.__sseMessages[0]
      })
      expect(firstMessage).toBe('hello')

      const sseState = sseServer.getState()
      expect(sseState.connected).toBe(true)
      expect(sseState.finished).toBe(false)
      expect(sseState.closed).toBe(false)
      expect(sseState.writeCount).toBeGreaterThan(0)

      const readyState = await cdpPage!.evaluate(() => {
        if (!window.__sseSource) {
          return -1
        }
        return window.__sseSource.readyState
      })
      expect(readyState).toBe(1)

      await cdpPage!.evaluate(() => {
        window.stopSse()
      })
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })
    } finally {
      if (browser) {
        await withTimeout({
          promise: browser.close(),
          timeoutMs: 5000,
          errorMessage: 'browser.close timed out',
        })
      }
      if (page) {
        await withTimeout({
          promise: page.close(),
          timeoutMs: 5000,
          errorMessage: 'page.close timed out',
        })
      }
      await withTimeout({
        promise: sseServer.close(),
        timeoutMs: 5000,
        errorMessage: 'sseServer.close timed out',
      })
    }
  }, 60000)
})

// --- No default page ---

describe('No default page', () => {
  let testCtx: TestContext | null = null
  let client: Awaited<ReturnType<typeof createMCPClient>>['client']
  let cleanup: (() => Promise<void>) | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-no-default-page-' })
    const result = await createMCPClient({ port: TEST_PORT })
    client = result.client
    cleanup = result.cleanup
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx, cleanup)
    cleanup = null
    testCtx = null
  })

  it('never opens a tab when code only uses context and zero tabs exist', async () => {
    if (!testCtx?.browserContext) throw new Error('Browser not initialized')
    const browserContext = testCtx.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })
    const connectedTabs = async () => {
      return serviceWorker.evaluate(() => {
        return globalThis.getExtensionState().tabs.size
      })
    }
    const chromeTabsBefore = browserContext.pages().length
    expect(await connectedTabs()).toBe(0)

    // reset forces a fresh relay connection with zero tabs (the relay used to auto-create one)
    const resetResult = await client.callTool({ name: 'reset', arguments: {} })
    expect((resetResult as any).content[0].text).toMatchInlineSnapshot(`"Connection reset successfully. 0 page(s) available."`)

    // SDK-style code that opens and closes its own page, then a context-only call
    const sdkResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const p = await context.newPage()
          try {
            await p.setContent('<h1>sdk</h1>')
          } finally {
            await p.close()
          }
          return context.pages().length
        `,
      },
    })
    const nextResult = await client.callTool({
      name: 'execute',
      arguments: { code: 'context.pages().length' },
    })

    expect({
      sdk: (sdkResult as any).content[0].text,
      next: (nextResult as any).content[0].text,
    }).toMatchInlineSnapshot(`
      {
        "next": "[return value] 0",
        "sdk": "[return value] 0",
      }
    `)
    expect(await connectedTabs()).toBe(0)
    expect(browserContext.pages().length).toBe(chromeTabsBefore)
  }, 60000)

  it('throws a helpful error when reading the page global', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          try {
            page.url()
          } catch (e) {
            return e.message
          }
        `,
      },
    })
    expect((result as any).content[0].text).toMatchInlineSnapshot(`"[return value] The global \`page\` was removed. Get a page from context instead: reuse one with \`context.pages().findLast((p) => p.url().includes('example.com'))\` (last = most recently opened), or create one with \`const page = await context.newPage()\`. Store it in \`state.page\` to reuse it across calls."`)
  }, 60000)
})
