// Does Page.startScreencast keep emitting frames once the shared tab stops being the
// active tab? The remote-control live view on playwriter.dev depends on the answer.
//
// Common advice says screencast only works for visible tabs. That is NOT what happens
// when chrome.debugger is attached, which is always the case for a tab shared through
// Playwriter: attachment keeps the tab rendering, document.visibilityState stays
// "visible", and frames keep arriving at the same rate after a real tab switch.
//
// This test pins that behaviour down, because the viewer would silently freeze if a
// future Chrome changed it. It drives everything through the extension service worker
// so it exercises the exact chrome.debugger path the feature uses, and switches tabs
// with chrome.tabs.update: Page.bringToFront does NOT change the active Chrome tab.

import { describe, expect, test } from 'vitest'
import { cleanupTestContext, getExtensionServiceWorker, setupTestContext, type TestContext } from './test-utils.js'

describe('screencast on a backgrounded tab', () => {
  test(
    'keeps streaming after the user switches tabs',
    async () => {
      let ctx: TestContext | null = null
      try {
        ctx = await setupTestContext({ port: 19971, tempDirPrefix: 'pw-screencast-', toggleExtension: true })
        const sw = await getExtensionServiceWorker(ctx.browserContext)

        const result = await sw.evaluate(async () => {
          const sleep = (ms: number) => {
            return new Promise((r) => setTimeout(r, ms))
          }
          const c = chrome

          const [tabA] = await c.tabs.query({ active: true, currentWindow: true })
          if (tabA?.id === undefined) {
            throw new Error('Active tab not found')
          }
          const tabAId = tabA.id
          await c.tabs.update(tabAId, { url: 'https://example.com' })
          await sleep(2500)
          const tabB = await c.tabs.create({ url: 'https://example.com', active: false })
          if (tabB.id === undefined) {
            throw new Error('Background tab was not created')
          }
          const tabBId = tabB.id
          await sleep(500)

          // Animate tab A so Chromium has something new to encode every frame.
          await c.debugger.sendCommand({ tabId: tabAId }, 'Runtime.evaluate', {
            expression: `document.body.innerHTML = '<style>@keyframes s{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}.b{width:200px;height:200px;background:red;animation:s 1s linear infinite}</style><div class=b></div>'`,
          })

          let frames = 0
          const onEvent = (source: chrome.debugger.DebuggerSession, method: string) => {
            if (source.tabId !== tabAId || method !== 'Page.screencastFrame') return
            frames++
          }
          c.debugger.onEvent.addListener(onEvent)

          // Read visibility with chrome.scripting so it works for tabs that have no
          // debugger attached. That is the control: if only the attached tab stays
          // "visible", debugger attachment is what keeps it rendering.
          const visibility = async (tabId: number) => {
            try {
              const [res] = await c.scripting.executeScript({
                target: { tabId },
                func: () => {
                  return document.visibilityState
                },
              })
              return res?.result
            } catch (error) {
              return `error: ${(error instanceof Error ? error.message : String(error)).slice(0, 80)}`
            }
          }

          await c.debugger.sendCommand({ tabId: tabAId }, 'Page.startScreencast', {
            format: 'jpeg',
            quality: 40,
            everyNthFrame: 1,
          })

          // ── phase 1: tab A is the active tab ──
          await c.tabs.update(tabAId, { active: true })
          await sleep(1500)
          frames = 0
          await sleep(2500)
          const activeFrames = frames
          const activeVisibility = await visibility(tabAId)

          // ── phase 2: tab B is the active tab, so A is backgrounded ──
          await c.tabs.update(tabBId, { active: true })
          await sleep(1500)
          const [activeNow] = await c.tabs.query({ active: true, currentWindow: true })
          const switched = activeNow?.id === tabBId
          const sameWindow = tabA.windowId === tabB.windowId
          const backgroundVisibility = await visibility(tabAId)
          frames = 0
          await sleep(2500)
          const backgroundFrames = frames

          c.debugger.onEvent.removeListener(onEvent)
          await c.tabs.remove(tabBId)

          return {
            switched,
            sameWindow,
            activeFrames,
            activeVisibility,
            backgroundFrames,
            backgroundVisibility,
          }
        })

        // Controls: the switch must be real, and both tabs must share a window,
        // otherwise "backgrounded" would mean nothing.
        expect(result.switched).toBe(true)
        expect(result.sameWindow).toBe(true)
        expect(result.activeVisibility).toBe('visible')

        // The behaviour the live view relies on.
        expect(result.activeFrames).toBeGreaterThan(20)
        expect(result.backgroundFrames).toBeGreaterThan(20)
        // Attachment keeps the tab rendering, so it never reports itself hidden.
        expect(result.backgroundVisibility).toBe('visible')
      } finally {
        await cleanupTestContext(ctx, null)
      }
    },
    60_000,
  )
})
