/**
 * Generates markdown resource files for the MCP at build time.
 *
 * These files are written to:
 * - playwriter/dist/ - for the MCP to read at runtime
 * - website/public/ - for hosting on playwriter.dev
 *
 * Source of truth:
 * - playwriter/src/skill.md - manually edited, contains full docs including CLI usage
 * - skills/playwriter/SKILL.md - stub with frontmatter for agent discovery
 *
 * Generated files:
 * - playwriter/dist/prompt.md - MCP prompt (skill.md minus CLI sections)
 * - website/public/SKILL.md - full copy for playwriter.dev/SKILL.md
 * - website/public/.well-known/skills/index.json - Agent Skills Discovery endpoint
 * - website/public/.well-known/skills/playwriter/SKILL.md - skill file with frontmatter
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dedent from 'string-dedent'
import { Lexer, type Token, type Tokens } from 'marked'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const playwriterDir = path.join(__dirname, '..')
const distDir = path.join(playwriterDir, 'dist')
const websitePublicDir = path.join(playwriterDir, '..', 'website', 'public', 'resources')

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(playwriterDir, relativePath), 'utf-8')
}

function writeToDestinations(filename: string, content: string) {
  ensureDir(distDir)
  ensureDir(websitePublicDir)

  const distPath = path.join(distDir, filename)
  const websitePath = path.join(websitePublicDir, filename)

  fs.writeFileSync(distPath, content, 'utf-8')
  fs.writeFileSync(websitePath, content, 'utf-8')

  console.log(`Generated ${filename}`)
}

function cleanTypes(typesContent: string): string {
  return typesContent.replace(/\/\/# sourceMappingURL=.*$/gm, '').trim()
}

function buildDebuggerApi() {
  const debuggerTypes = cleanTypes(readFile('dist/debugger.d.ts'))
  const debuggerExamples = readFile('src/debugger-examples.ts')

  const content = dedent`
    # Debugger API Reference

    ## Types

    \`\`\`ts
    ${debuggerTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${debuggerExamples}
    \`\`\`
  `

  writeToDestinations('debugger-api.md', content)
}

function buildEditorApi() {
  const editorTypes = cleanTypes(readFile('dist/editor.d.ts'))
  const editorExamples = readFile('src/editor-examples.ts')

  const content = dedent`
    # Editor API Reference

    The Editor class provides a Claude Code-like interface for viewing and editing web page scripts at runtime.

    ## Types

    \`\`\`ts
    ${editorTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${editorExamples}
    \`\`\`
  `

  writeToDestinations('editor-api.md', content)
}

function buildStylesApi() {
  const stylesTypes = cleanTypes(readFile('dist/styles.d.ts'))
  const stylesExamples = readFile('src/styles-examples.ts')

  const content = dedent`
    # Styles API Reference

    The getStylesForLocator function inspects CSS styles applied to an element, similar to browser DevTools "Styles" panel.

    ## Types

    \`\`\`ts
    ${stylesTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${stylesExamples}
    \`\`\`
  `

  writeToDestinations('styles-api.md', content)
}

function buildPerformanceProfiling() {
  const performanceExamples = readFile('src/performance-examples.ts')

  const content = dedent`
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

    \`\`\`bash
    playwriter session new
    playwriter -s 1 -e 'state.page = context.pages().find((p) => p.url() === "about:blank") ?? (await context.newPage()); await state.page.goto("https://example.com", { waitUntil: "domcontentloaded" })'
    \`\`\`

    Collect a concise vitals report:

    \`\`\`bash
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
    \`\`\`

    List the heaviest requests with CDP:

    \`\`\`bash
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
    \`\`\`

    Check interactivity blockers:

    \`\`\`bash
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
    \`\`\`

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

    - If vitals and request sizes are not enough, record a **\`.cpuprofile\`** with Playwriter's raw **\`Profiler.*\`** CDP commands and inspect it with **[profano](https://github.com/remorses/profano)**.
    - A good place to keep your reusable profiling snippets is your dots repo, for example **\`~/.config/opencode/\`**.

    **Good load event is not enough**

    - A page can have a decent \`load\` time and still feel slow if **LCP** or **long tasks** are bad.
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

    \`\`\`ts
    ${performanceExamples}
    \`\`\`
  `

  writeToDestinations('performance-profiling.md', content)
}

/**
 * Removes CLI-related sections from skill.md to create prompt.md for the MCP.
 *
 * Sections removed:
 * - "## CLI Usage" section and all its subsections
 */
function stripCliSectionsFromSkill(skillContent: string): string {
  // Parse markdown tokens
  const tokens = Lexer.lex(skillContent)

  // Filter out CLI Usage section and its subsections
  const filteredTokens: Token[] = []
  let skipUntilLevel: number | null = null

  for (const token of tokens) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading
      // Check if we should start skipping (CLI Usage section)
      if (heading.depth === 2 && heading.text === 'CLI Usage') {
        skipUntilLevel = 2
        continue
      }
      // Check if we should stop skipping (next h2 section)
      if (skipUntilLevel !== null && heading.depth <= skipUntilLevel) {
        skipUntilLevel = null
      }
    }

    if (skipUntilLevel === null) {
      filteredTokens.push(token)
    }
  }

  // Reconstruct markdown from tokens
  return (
    filteredTokens
      .map((token) => {
        return token.raw
      })
      .join('')
      .trim() + '\n'
  )
}

function buildPromptFromSkill() {
  // Read skill.md as source of truth
  const skillPath = path.join(playwriterDir, 'src', 'skill.md')
  const skillContent = fs.readFileSync(skillPath, 'utf-8')

  // Generate prompt.md for MCP (without CLI sections)
  const promptContent = stripCliSectionsFromSkill(skillContent)
  const distPromptPath = path.join(distDir, 'prompt.md')
  fs.writeFileSync(distPromptPath, promptContent, 'utf-8')
  console.log('Generated playwriter/dist/prompt.md (from skill.md)')

  // Copy full skill.md to website/public/ for hosting at playwriter.dev/SKILL.md
  const websitePublicRoot = path.join(playwriterDir, '..', 'website', 'public')
  ensureDir(websitePublicRoot)
  fs.writeFileSync(path.join(websitePublicRoot, 'SKILL.md'), skillContent, 'utf-8')
  console.log('Generated website/public/SKILL.md')
}

/**
 * Parses YAML frontmatter from a markdown file.
 * Returns { frontmatter, body } where frontmatter is the parsed YAML object.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const yamlContent = match[1]
  const body = match[2]

  // Simple YAML parsing for key: value pairs
  const frontmatter: Record<string, string> = {}
  for (const line of yamlContent.split(/\r?\n/)) {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim()
      const value = line.slice(colonIndex + 1).trim()
      frontmatter[key] = value
    }
  }

  return { frontmatter, body }
}

/**
 * Builds the Well-Known Skills Discovery structure.
 *
 * Creates:
 * - /.well-known/skills/index.json - discovery endpoint
 * - /.well-known/skills/playwriter/SKILL.md - skill file
 *
 * See: https://agentskills.io/specification
 */
function buildWellKnownSkills() {
  const repoRoot = path.join(playwriterDir, '..')
  const skillSourcePath = path.join(repoRoot, 'skills', 'playwriter', 'SKILL.md')
  const websitePublicRoot = path.join(repoRoot, 'website', 'public')
  const wellKnownDir = path.join(websitePublicRoot, '.well-known', 'skills')
  const playwriterSkillDir = path.join(wellKnownDir, 'playwriter')

  // Read and parse the skill file
  const skillContent = fs.readFileSync(skillSourcePath, 'utf-8')
  const { frontmatter } = parseFrontmatter(skillContent)

  // Ensure directories exist
  ensureDir(wellKnownDir)
  ensureDir(playwriterSkillDir)

  // Copy SKILL.md to well-known location
  fs.writeFileSync(path.join(playwriterSkillDir, 'SKILL.md'), skillContent, 'utf-8')
  console.log('Generated website/public/.well-known/skills/playwriter/SKILL.md')

  // Generate index.json
  const indexJson = {
    skills: [
      {
        name: frontmatter.name || 'playwriter',
        description: frontmatter.description || '',
        files: ['SKILL.md'],
      },
    ],
  }

  fs.writeFileSync(path.join(wellKnownDir, 'index.json'), JSON.stringify(indexJson, null, 2) + '\n', 'utf-8')
  console.log('Generated website/public/.well-known/skills/index.json')
}

// Run all builds
buildDebuggerApi()
buildEditorApi()
buildStylesApi()
buildPerformanceProfiling()
buildPromptFromSkill()
buildWellKnownSkills()

console.log('Resource files generated successfully')
