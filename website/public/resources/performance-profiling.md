# Profile Website Performance with Playwriter

Playwriter can profile a real website in your own Chrome using **CDP**, **Navigation Timing**,
and **PerformanceObserver**.

Use it to answer four practical questions quickly:

1. **Did the page render fast enough?**
2. **What requests cost the most bytes?**
3. **What blocked first paint or LCP?**
4. **What blocked interactivity?**

## What to measure

| Metric | Good | Needs work | Usually means |
| --- | --- | --- | --- |
| **TTFB** | under **800ms** | over **1.2s** | slow server or cache miss |
| **FCP** | under **1.8s** | over **3s** | content appears late |
| **LCP** | under **2.5s** | over **4s** | hero image, font, CSS, server, or JS delay |
| **CLS** | under **0.1** | over **0.25** | unstable layout |
| **Long task** | under **50ms** | over **100ms** | main thread blocked by JS |
| **JS transfer** | under **250KB** | over **500KB** | too much hydration or client code |
| **Font / media transfer** | context dependent | large above-the-fold assets | fonts, posters, videos, hero images |

## What usually blocks what

- **First paint / FCP** is usually gated by **TTFB**, critical HTML, critical CSS, and above-the-fold fonts/images.
- **LCP** is usually gated by the **largest hero asset**. Common causes: hero image, poster image, custom font, render-blocking CSS, or slow server response.
- **Interactivity** is usually gated by **long tasks**. Common causes: too much JS on startup, hydration, or a large framework chunk.
- **Load event** often stays late because of **non-critical assets** like videos, analytics, background images, and delayed client bundles.

## Quick commands

Create a session and open a page:

```bash
playwriter session new
playwriter -s 1 -e 'state.page = await context.newPage(); await state.page.goto("https://example.com", { waitUntil: "domcontentloaded" })'
```

Collect a concise vitals report:

```bash
playwriter -s 1 -e "$(cat <<'EOF'
await state.page.evaluate(() => {
  const metrics = { paints: {}, lcp: 0, cls: 0 }
  globalThis.__pwMetrics = metrics

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      metrics.paints[entry.name] = entry.startTime
    }
  }).observe({ type: 'paint', buffered: true })

  new PerformanceObserver((list) => {
    const lastEntry = list.getEntries().at(-1)
    if (lastEntry) {
      metrics.lcp = lastEntry.startTime
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true })

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) {
        metrics.cls += entry.value
      }
    }
  }).observe({ type: 'layout-shift', buffered: true })
})

await state.page.reload({ waitUntil: 'domcontentloaded' })
await waitForPageLoad({ page: state.page, timeout: 10000 })
await state.page.waitForTimeout(3000)

const report = await state.page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const metrics = globalThis.__pwMetrics
  return {
    ttfb: nav?.responseStart || 0,
    domContentLoaded: nav?.domContentLoadedEventEnd || 0,
    load: nav?.loadEventEnd || 0,
    fcp: metrics?.paints['first-contentful-paint'] || 0,
    lcp: metrics?.lcp || 0,
    cls: metrics?.cls || 0,
  }
})

console.log(JSON.stringify(report, null, 2))
EOF
)"
```

List the heaviest requests with CDP:

```bash
playwriter -s 1 -e "$(cat <<'EOF'
const cdp = await getCDPSession({ page: state.page })
await cdp.send('Network.enable')
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

const responses = new Map()
const finished = new Map()

cdp.on('Network.responseReceived', (event) => {
  responses.set(event.requestId, {
    url: event.response.url,
    mimeType: event.response.mimeType,
  })
})

cdp.on('Network.loadingFinished', (event) => {
  finished.set(event.requestId, event.encodedDataLength)
})

await state.page.reload({ waitUntil: 'domcontentloaded' })
await waitForPageLoad({ page: state.page, timeout: 10000 })
await state.page.waitForTimeout(3000)

const largest = [...responses.entries()]
  .map(([requestId, response]) => ({
    url: response.url,
    mimeType: response.mimeType,
    bytes: finished.get(requestId) || 0,
  }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 10)

console.log(JSON.stringify(largest, null, 2))
EOF
)"
```

Check interactivity blockers:

```bash
playwriter -s 1 -e "$(cat <<'EOF'
await state.page.evaluate(() => {
  globalThis.__pwLongTasks = []
  globalThis.__pwEvents = []

  new PerformanceObserver((list) => {
    globalThis.__pwLongTasks.push(
      ...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })),
    )
  }).observe({ type: 'longtask', buffered: true })

  new PerformanceObserver((list) => {
    globalThis.__pwEvents.push(
      ...list.getEntries().map((entry) => ({
        name: entry.name,
        duration: entry.duration,
        interactionId: entry.interactionId,
      })),
    )
  }).observe({ type: 'event', buffered: true, durationThreshold: 16 })
})

await state.page.getByRole('button').first().click()
await state.page.waitForTimeout(1000)

const report = await state.page.evaluate(() => ({
  longTasks: globalThis.__pwLongTasks.filter((entry) => entry.duration >= 50),
  interactions: globalThis.__pwEvents.filter((entry) => entry.interactionId !== 0),
}))

console.log(JSON.stringify(report, null, 2))
EOF
)"
```

## How to read the results

**Fast render, heavy payload**

- If **FCP** and **LCP** are good but total bytes are huge, the page probably **looks fast on desktop** but wastes bandwidth on mobile.
- This often happens with **hero videos**, large poster images, or custom fonts.

**Slow first paint**

- If **TTFB** is high, fix **server latency** or caching first.
- If **TTFB** is fine but **FCP** is slow, inspect critical CSS, fonts, and above-the-fold images.

**Slow interactivity**

- If you see **long tasks over 50ms**, startup JS is the first suspect.
- Look for large client bundles, hydration-heavy UI, and event handlers doing too much work.

**Need deeper CPU answers**

- If vitals and request sizes are not enough, record a **`.cpuprofile`** with Playwriter's raw **`Profiler.*`** CDP commands and inspect it with **[profano](https://github.com/remorses/profano)**.
- A good place to keep your reusable profiling snippets is your dots repo, for example **`~/.config/opencode/`**.

**Good load event is not enough**

- A page can have a decent `load` time and still feel slow if **LCP** or **long tasks** are bad.
- Prefer **TTFB + FCP + LCP + CLS + long tasks** over the load event alone.

## Performance checklist

**If TTFB is bad**

- cache HTML closer to users
- reduce origin work before response
- avoid expensive server-side data fetching on the critical route

**If FCP or LCP is bad**

- trim or defer render-blocking CSS
- avoid large above-the-fold fonts and images
- preload only truly critical assets
- compress hero media harder

**If interactivity is bad**

- reduce startup JS
- split large client bundles
- avoid hydrating UI that is not immediately interactive
- move optional widgets behind user action or idle time
- if the culprit is still unclear, switch from vitals to a CPU profile and inspect hot functions with **profano**

**If bytes are bad but vitals look good**

- optimize for slower devices anyway
- background videos are the first thing to cut
- subset fonts and trim non-critical client features

## Examples

```ts
// Example snippets for profiling website performance with Playwriter and CDP.

import { console, getCDPSession, state } from './debugger-examples-types.js'

type PerfMetrics = {
  paints: Record<string, number>
  lcp: number
  cls: number
}

type ObservedPerfEntry = {
  name: string
  startTime: number
  duration: number
  hadRecentInput?: boolean
  value?: number
  interactionId?: number
}

type NavigationTimingEntry = {
  responseStart: number
  domContentLoadedEventEnd: number
  loadEventEnd: number
}

type LongTaskEntry = {
  startTime: number
  duration: number
}

type EventTimingEntry = {
  name: string
  duration: number
  interactionId: number
}

// Example: Collect navigation timing and basic web vitals from the current page
async function collectWebVitals() {
  await state.page.evaluate(() => {
    const metrics: PerfMetrics = {
      paints: {},
      lcp: 0,
      cls: 0,
    }

    const perfGlobal = globalThis as typeof globalThis & {
      __pwPerfMetrics?: PerfMetrics
    }

    perfGlobal.__pwPerfMetrics = metrics

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as ObservedPerfEntry[]) {
        metrics.paints[entry.name] = entry.startTime
      }
    }).observe({ type: 'paint', buffered: true } as never)

    new PerformanceObserver((list) => {
      const entries = list.getEntries() as ObservedPerfEntry[]
      const lastEntry = entries[entries.length - 1]
      if (!lastEntry) {
        return
      }
      metrics.lcp = lastEntry.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true } as never)

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as ObservedPerfEntry[]) {
        if (entry.hadRecentInput) {
          continue
        }
        metrics.cls += entry.value || 0
      }
    }).observe({ type: 'layout-shift', buffered: true } as never)
  })

  await state.page.reload({ waitUntil: 'domcontentloaded' })

  const report = await state.page.evaluate(() => {
    const perfGlobal = globalThis as typeof globalThis & {
      __pwPerfMetrics?: PerfMetrics
    }
    const nav = performance.getEntriesByType('navigation' as never)[0] as unknown as
      | NavigationTimingEntry
      | undefined
    const metrics = perfGlobal.__pwPerfMetrics

    return {
      ttfb: nav?.responseStart || 0,
      domContentLoaded: nav?.domContentLoadedEventEnd || 0,
      load: nav?.loadEventEnd || 0,
      fcp: metrics?.paints['first-contentful-paint'] || 0,
      lcp: metrics?.lcp || 0,
      cls: metrics?.cls || 0,
    }
  })

  console.log(report)
}

// Example: Measure the biggest transferred requests with raw CDP network events
async function collectHeaviestRequests() {
  const cdp = await getCDPSession({ page: state.page })
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  const responses = new Map<string, { url: string; mimeType: string }>()
  const finished = new Map<string, number>()

  cdp.on('Network.responseReceived', (event) => {
    responses.set(event.requestId, {
      url: event.response.url,
      mimeType: event.response.mimeType,
    })
  })

  cdp.on('Network.loadingFinished', (event) => {
    finished.set(event.requestId, event.encodedDataLength)
  })

  await state.page.reload({ waitUntil: 'domcontentloaded' })

  const largest = [...responses.entries()]
    .map(([requestId, response]) => {
      return {
        url: response.url,
        mimeType: response.mimeType,
        bytes: finished.get(requestId) || 0,
      }
    })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10)

  console.log(largest)
}

// Example: Check whether interactivity is blocked by long tasks or slow events
async function measureInteractivity() {
  await state.page.evaluate(() => {
    const perfGlobal = globalThis as typeof globalThis & {
      __pwLongTasks?: LongTaskEntry[]
      __pwEventTimings?: EventTimingEntry[]
    }

    perfGlobal.__pwLongTasks = []
    perfGlobal.__pwEventTimings = []

    new PerformanceObserver((list) => {
      perfGlobal.__pwLongTasks?.push(
        ...(list.getEntries() as ObservedPerfEntry[]).map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })),
      )
    }).observe({ type: 'longtask', buffered: true } as never)

    new PerformanceObserver((list) => {
      perfGlobal.__pwEventTimings?.push(
        ...(list.getEntries() as ObservedPerfEntry[]).map((entry) => ({
          name: entry.name,
          duration: entry.duration,
          interactionId: entry.interactionId || 0,
        })),
      )
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as never)
  })

  const button = state.page.getByRole('button').first()
  await button.click()

  const report = await state.page.evaluate(() => {
    const perfGlobal = globalThis as typeof globalThis & {
      __pwLongTasks?: LongTaskEntry[]
      __pwEventTimings?: EventTimingEntry[]
    }

    return {
      longTasks: (perfGlobal.__pwLongTasks || []).filter((entry) => entry.duration >= 50),
      events: (perfGlobal.__pwEventTimings || []).filter((entry) => entry.interactionId !== 0),
    }
  })

  console.log(report)
}

export { collectWebVitals, collectHeaviestRequests, measureInteractivity }

```