import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Protocol } from 'devtools-protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildRawSnapshotTree,
  filterFullSnapshotTree,
  filterInteractiveSnapshotTree,
  type SnapshotNode,
} from './aria-snapshot.js'
import {
  isExecutionConsoleMethod,
  presentExecutionConsoleEvents,
  type ExecutionConsoleEvent,
} from './execution-result.js'
import { cleanupTestContext, setupTestContext, type TestContext } from './test-utils.js'

const TEST_PORT = 19989
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`
const CORPUS_ROOT = path.join(import.meta.dirname, '..', 'agent-output-corpus')
const PLAYWRITER_ROOT = path.join(import.meta.dirname, '..')
const VITE_NODE = path.join(PLAYWRITER_ROOT, 'node_modules', 'vite-node', 'vite-node.js')
const execFileAsync = promisify(execFile)

type CorpusExecutionResult = {
  readonly agentText: string | null
  readonly consoleEvents: readonly ExecutionConsoleEvent[]
  readonly isError: boolean
  readonly returnValue?: unknown
  readonly text: string
}

type CorpusCase = {
  readonly artifactName: string
  readonly description: string
  readonly diagnostics?: 'hacker-news'
  readonly interactiveOnly: boolean
  readonly prepareCode: string
  readonly title: string
  readonly expectedText: readonly string[]
}

const CORPUS_CASES: readonly CorpusCase[] = [
  {
    artifactName: 'nested-form.md',
    title: 'Deterministic Nested Form',
    description: 'This comparison mirrors the nested form fixture from `aria-snapshot.unit.test.ts`.',
    interactiveOnly: false,
    prepareCode: `
await page.setContent(\`<!doctype html>
<html>
  <body>
    <form aria-label="Account">
      <label>Email <input aria-label="Email" data-testid="email-input" /></label>
      <button id="save-primary" type="button">Save</button>
      <button id="save-secondary" type="button">Save</button>
    </form>
  </body>
</html>\`);
await page.locator('[data-testid="email-input"]').waitFor();
return page.url();
`,
    expectedText: ['form "Account"', 'textbox "Email"', '[id="save-primary"]'],
  },
  {
    artifactName: 'hacker-news.md',
    title: 'Hacker News Interactive Tree',
    description: 'This comparison reuses the Hacker News case from `relay-core.test.ts`.',
    diagnostics: 'hacker-news',
    interactiveOnly: true,
    prepareCode: `
await page.goto('https://news.ycombinator.com/item?id=1', { waitUntil: 'domcontentloaded' });
await page.locator('a[href="news"]').first().waitFor({ timeout: 10000 });
await page.locator('a.hnuser').first().waitFor({ timeout: 10000 });
return page.url();
`,
    expectedText: ['role=link', 'Hacker News'],
  },
  {
    artifactName: 'prosemirror-contenteditable.md',
    title: 'ProseMirror Contenteditable',
    description: 'This comparison reuses the ProseMirror case from `aria-snapshot.test.ts`.',
    interactiveOnly: true,
    prepareCode: `
await page.goto('https://prosemirror.net/', { waitUntil: 'domcontentloaded' });
await page.locator('[contenteditable="true"]').waitFor({ timeout: 10000 });
await page.waitForTimeout(2000);
return page.url();
`,
    expectedText: ['textbox', '[contenteditable="true"]'],
  },
  {
    artifactName: 'github-dense-ui.md',
    title: 'GitHub Dense UI',
    description: 'This comparison reuses the GitHub case from `aria-snapshot.test.ts`.',
    interactiveOnly: true,
    prepareCode: `
await page.goto('https://github.com/', { waitUntil: 'domcontentloaded' });
await page.locator('body').waitFor({ timeout: 10000 });
await page.waitForTimeout(1000);
return page.url();
`,
    expectedText: ['role=link'],
  },
]

type DiagnosticDomNode = {
  readonly attributes: Map<string, string>
  readonly backendNodeId: Protocol.DOM.BackendNodeId
  readonly nodeId: Protocol.DOM.NodeId
  readonly nodeName: string
  readonly parentId?: Protocol.DOM.NodeId
}

type VisibleNodeEntry = {
  readonly node: SnapshotNode
  readonly parent: SnapshotNode | null
}

type HackerNewsDiagnostic = {
  readonly axAncestors: readonly string[]
  readonly domAncestors: readonly string[]
  readonly indentOffset: number
  readonly label: string
  readonly visibleChildren: readonly string[]
  readonly visibleParent: string | null
}

type SnapshotSource = {
  readonly axByBackendId: ReadonlyMap<Protocol.DOM.BackendNodeId, Protocol.Accessibility.AXNode>
  readonly axById: ReadonlyMap<Protocol.Accessibility.AXNodeId, Protocol.Accessibility.AXNode>
  readonly domByBackendId: ReadonlyMap<Protocol.DOM.BackendNodeId, DiagnosticDomNode>
  readonly domById: ReadonlyMap<Protocol.DOM.NodeId, DiagnosticDomNode>
  readonly roots: readonly SnapshotNode[]
}

const HACKER_NEWS_DIAGNOSTIC_TARGETS = [
  { name: '3\u00a0comments' },
  { id: 'up_15' },
  { name: 'sama' },
  { name: "Consider applying for YC's Fall 2026 batch! Applications are open till July 27." },
  { name: 'Guidelines' },
  { name: 'API' },
] as const

function attributesByName(attributes?: readonly string[]): Map<string, string> {
  const result = new Map<string, string>()
  if (!attributes) {
    return result
  }
  for (let index = 0; index < attributes.length; index += 2) {
    const name = attributes[index]
    if (name) {
      result.set(name, attributes[index + 1] ?? '')
    }
  }
  return result
}

function axValue(value?: Protocol.Accessibility.AXValue): string {
  return value?.value == null ? '' : String(value.value)
}

function describeAxNode(node: Protocol.Accessibility.AXNode): string {
  const role = axValue(node.role).toLowerCase() || 'unknown'
  const name = axValue(node.name).trim()
  return `${role}${node.ignored ? ' [ignored]' : ''}${name ? ` "${name}"` : ''}`
}

function describeDomNode(node: DiagnosticDomNode): string {
  const id = node.attributes.get('id')
  const className = node.attributes.get('class')?.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
  return `${node.nodeName.toLowerCase()}${id ? `#${id}` : ''}${className ? `.${className}` : ''}`
}

function describeVisibleNode(node: SnapshotNode): string {
  return `${node.role}${node.name ? ` "${node.name}"` : ''}`
}

function collectVisibleNodes(nodes: readonly SnapshotNode[], parent: SnapshotNode | null = null): VisibleNodeEntry[] {
  return nodes.flatMap((node) => [{ node, parent }, ...collectVisibleNodes(node.children, node)])
}

function ancestorPath<T>(input: {
  readonly node: T
  readonly parent: (node: T) => T | undefined
  readonly describe: (node: T) => string
}): string[] {
  const path: string[] = []
  let current: T | undefined = input.node
  while (current) {
    path.push(input.describe(current))
    current = input.parent(current)
  }
  return path.reverse()
}

function markdownValue(value: string): string {
  return value.replaceAll('|', '\\|')
}

function diagnosticsMarkdown(diagnostics: readonly HackerNewsDiagnostic[]): string {
  const rows = diagnostics.map((diagnostic) => {
    return `| ${markdownValue(diagnostic.label)} | ${diagnostic.indentOffset} | ${markdownValue(diagnostic.visibleParent ?? '(root)')} | ${markdownValue(diagnostic.visibleChildren.join(', ') || '(none)')} | ${markdownValue(diagnostic.axAncestors.join(' -> '))} | ${markdownValue(diagnostic.domAncestors.join(' -> '))} |`
  })
  return `# Hacker News Snapshot Structure Diagnostics

This diagnostic compares the filtered visible tree with the original accessibility and DOM ancestry. It does not change snapshot behavior.

| Visible node | indentOffset | Visible parent | Visible children | AX ancestors | DOM ancestors |
| --- | ---: | --- | --- | --- | --- |
${rows.join('\n')}
`
}

function isContentEditable(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '' || normalized === 'true' || normalized === 'plaintext-only'
}

async function collectSnapshotSource(testContext: TestContext, interactiveOnly: boolean): Promise<SnapshotSource> {
  const page = testContext.browserContext
    .pages()
    .filter((candidate) => !candidate.url().startsWith('chrome-extension://'))
    .at(-1)
  if (!page) {
    throw new Error('Corpus page was not found for snapshot diagnostics.')
  }

  const cdp = await testContext.browserContext.newCDPSession(page)
  try {
    await cdp.send('DOM.enable')
    await cdp.send('Accessibility.enable')
    const { nodes: domNodes } = await cdp.send('DOM.getFlattenedDocument', { depth: -1, pierce: true })
    const { nodes: axNodes } = await cdp.send('Accessibility.getFullAXTree')

    const domById = new Map<Protocol.DOM.NodeId, DiagnosticDomNode>()
    const domByBackendId = new Map<Protocol.DOM.BackendNodeId, DiagnosticDomNode>()
    for (const node of domNodes) {
      const entry: DiagnosticDomNode = {
        nodeId: node.nodeId,
        parentId: node.parentId,
        backendNodeId: node.backendNodeId,
        nodeName: node.nodeName,
        attributes: attributesByName(node.attributes),
      }
      domById.set(entry.nodeId, entry)
      domByBackendId.set(entry.backendNodeId, entry)
    }

    const axById = new Map(axNodes.map((node) => [node.nodeId, node]))
    const axByBackendId = new Map(
      axNodes.flatMap((node) => (node.backendDOMNodeId ? [[node.backendDOMNodeId, node] as const] : [])),
    )

    const promotedContentEditableIds = new Set<Protocol.DOM.BackendNodeId>()
    for (const domNode of domByBackendId.values()) {
      if (!isContentEditable(domNode.attributes.get('contenteditable'))) {
        continue
      }
      const axNode = axByBackendId.get(domNode.backendNodeId)
      if (!axNode || axValue(axNode.role).toLowerCase() === 'textbox') {
        continue
      }
      axNode.role = { type: 'role', value: 'textbox' }
      promotedContentEditableIds.add(domNode.backendNodeId)
    }

    const root =
      axNodes.find((node) => {
        const role = axValue(node.role).toLowerCase()
        return role === 'rootwebarea' || role === 'webarea'
      }) ?? axNodes.find((node) => !node.parentId)
    if (!root) {
      throw new Error('Hacker News accessibility root was not found.')
    }

    const rawRoots = (root.childIds ?? [root.nodeId]).flatMap((nodeId) => {
      const raw = buildRawSnapshotTree({ nodeId, axById, isNodeInScope: () => true })
      return raw ? [raw] : []
    })
    const roots = rawRoots.flatMap((raw) => {
      if (interactiveOnly) {
        return filterInteractiveSnapshotTree({
          node: raw,
          ancestorNames: [],
          labelContext: false,
          domByBackendId,
          promotedContentEditableIds,
          createRefForNode: () => null,
        }).nodes
      }
      return filterFullSnapshotTree({
        node: raw,
        ancestorNames: [],
        domByBackendId,
        promotedContentEditableIds,
        createRefForNode: () => null,
      }).nodes
    })

    return { roots, axById, axByBackendId, domById, domByBackendId }
  } finally {
    await cdp.detach()
  }
}

function collectHackerNewsDiagnostics(source: SnapshotSource): HackerNewsDiagnostic[] {
  const visibleNodes = collectVisibleNodes(source.roots)

  return HACKER_NEWS_DIAGNOSTIC_TARGETS.map((target) => {
    const visible = visibleNodes.find(({ node }) => {
      if ('name' in target) {
        return node.name === target.name
      }
      return (
        node.backendNodeId != null && source.domByBackendId.get(node.backendNodeId)?.attributes.get('id') === target.id
      )
    })
    if (!visible?.node.backendNodeId) {
      throw new Error(`Hacker News diagnostic target was not found: ${JSON.stringify(target)}`)
    }
    const domNode = source.domByBackendId.get(visible.node.backendNodeId)
    const axNode = source.axByBackendId.get(visible.node.backendNodeId)
    if (!domNode || !axNode) {
      throw new Error(`Hacker News source node was not found: ${describeVisibleNode(visible.node)}`)
    }
    return {
      label: describeVisibleNode(visible.node),
      indentOffset: visible.node.indentOffset ?? 0,
      visibleParent: visible.parent ? describeVisibleNode(visible.parent) : null,
      visibleChildren: visible.node.children.map(describeVisibleNode),
      axAncestors: ancestorPath({
        node: axNode,
        parent: (node) => (node.parentId ? source.axById.get(node.parentId) : undefined),
        describe: describeAxNode,
      }),
      domAncestors: ancestorPath({
        node: domNode,
        parent: (node) => (node.parentId ? source.domById.get(node.parentId) : undefined),
        describe: describeDomNode,
      }),
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(response: Response): Promise<unknown> {
  const value: unknown = await response.json()
  if (!response.ok) {
    throw new Error(`Playwriter corpus request failed (${response.status}): ${JSON.stringify(value)}`)
  }
  return value
}

function readSessionId(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== 'string') {
    throw new Error(`Playwriter corpus session response is invalid: ${JSON.stringify(value)}`)
  }
  return value.id
}

function readExecutionResult(value: unknown): CorpusExecutionResult {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.isError !== 'boolean') {
    throw new Error(`Playwriter corpus execution response is invalid: ${JSON.stringify(value)}`)
  }
  const consoleEvents = Array.isArray(value.consoleEvents)
    ? value.consoleEvents.filter((event): event is ExecutionConsoleEvent => {
        return isRecord(event) && isExecutionConsoleMethod(event.method) && typeof event.text === 'string'
      })
    : []
  if (Array.isArray(value.consoleEvents) && consoleEvents.length !== value.consoleEvents.length) {
    throw new Error(`Playwriter corpus consoleEvents are invalid: ${JSON.stringify(value.consoleEvents)}`)
  }
  return {
    agentText: typeof value.agentText === 'string' ? value.agentText : null,
    consoleEvents,
    text: value.text,
    isError: value.isError,
    ...('returnValue' in value ? { returnValue: value.returnValue } : {}),
  }
}

function readSnapshot(value: unknown): string {
  if (!isRecord(value) || typeof value.snapshot !== 'string') {
    throw new Error(`Playwriter corpus returnValue is invalid: ${JSON.stringify(value)}`)
  }
  return value.snapshot
}

async function execute(sessionId: string, code: string): Promise<CorpusExecutionResult> {
  const response = await fetch(`${BASE_URL}/cli/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, code, timeout: 30_000 }),
  })
  return readExecutionResult(await readJson(response))
}

async function executeCli(sessionId: string, code: string): Promise<string> {
  const executed = await execFileAsync(
    process.execPath,
    [
      VITE_NODE,
      path.join(import.meta.dirname, 'cli.ts'),
      '--host',
      '127.0.0.1',
      '--session',
      sessionId,
      '--eval',
      code,
    ],
    {
      cwd: PLAYWRITER_ROOT,
      env: {
        ...process.env,
        PLAYWRITER_PORT: String(TEST_PORT),
      },
      maxBuffer: 2 * 1024 * 1024,
    },
  )
  return executed.stdout.trimEnd()
}

function upstreamSnapshotText(text: string): string {
  const prefix = 'Console output:\n[log] '
  if (!text.startsWith(prefix)) {
    throw new Error(`Unexpected upstream snapshot framing: ${text.slice(0, 120)}`)
  }
  return text.slice(prefix.length).trimEnd()
}

function snapshotCode(input: { readonly interactiveOnly: boolean; readonly normalized: boolean }): string {
  return `await snapshot({
  page,
  showDiffSinceLastCall: false,
  interactiveOnly: ${input.interactiveOnly},
  normalizeIgnoredIndent: ${input.normalized},
})`
}

function comparisonMarkdown(input: {
  readonly candidateAgentOutput: string
  readonly corpusCase: CorpusCase
  readonly structuredResult: {
    readonly agentText: string | null
    readonly consoleEvents: readonly ExecutionConsoleEvent[]
    readonly returnValue: unknown
  }
  readonly upstreamText: string
}): string {
  return `# ${input.corpusCase.title}

${input.corpusCase.description}
Both outputs come from the same Playwriter executor, page, accessibility extraction, and renderer.

## Upstream Playwriter CLI Output

\`\`\`text
${input.upstreamText}
\`\`\`

## Relay Structured Result

\`\`\`json
${JSON.stringify(input.structuredResult, null, 2)}
\`\`\`

## Candidate ATM Agent Output

\`\`\`text
${input.candidateAgentOutput}
\`\`\`
`
}

describe('agent output corpus', () => {
  let context: TestContext | null = null
  let sessionId: string | null = null

  beforeAll(async () => {
    context = await setupTestContext({
      port: TEST_PORT,
      tempDirPrefix: 'agent-output-corpus-',
      toggleExtension: true,
    })
    const response = await fetch(`${BASE_URL}/cli/session/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: process.cwd() }),
    })
    sessionId = readSessionId(await readJson(response))
  }, 60_000)

  afterAll(async () => {
    if (sessionId) {
      await fetch(`${BASE_URL}/cli/session/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(() => undefined)
    }
    await cleanupTestContext(context)
    context = null
    sessionId = null
  })

  for (const corpusCase of CORPUS_CASES) {
    it(`renders upstream and ATM output for ${corpusCase.title}`, async () => {
      if (!sessionId) {
        throw new Error('Playwriter corpus session was not created.')
      }

      const prepared = await execute(sessionId, corpusCase.prepareCode)
      expect(prepared.isError, prepared.text).toBe(false)

      const upstreamText = await executeCli(
        sessionId,
        `console.log(${snapshotCode({ interactiveOnly: corpusCase.interactiveOnly, normalized: false })});`,
      )
      const structured = await execute(
        sessionId,
        `
const snapshotText = ${snapshotCode({ interactiveOnly: corpusCase.interactiveOnly, normalized: true })};
console.log(snapshotText);
return { snapshot: snapshotText };
`,
      )
      expect(structured.isError, structured.text).toBe(false)

      const upstreamSnapshot = upstreamSnapshotText(upstreamText)
      const candidateSnapshot = readSnapshot(structured.returnValue).trimEnd()
      const candidateAgentOutput = structured.agentText
        ?? presentExecutionConsoleEvents(structured.consoleEvents)
      expect(candidateSnapshot).not.toBe(upstreamSnapshot)
      expect(candidateSnapshot.startsWith('- ')).toBe(false)
      expect(candidateAgentOutput).toBe(candidateSnapshot)
      for (const expectedText of corpusCase.expectedText) {
        expect(candidateSnapshot).toContain(expectedText)
      }

      const corpusPath = path.join(CORPUS_ROOT, corpusCase.artifactName)
      const markdown = comparisonMarkdown({
        candidateAgentOutput,
        corpusCase,
        structuredResult: {
          agentText: structured.agentText,
          consoleEvents: structured.consoleEvents,
          returnValue: structured.returnValue,
        },
        upstreamText,
      })
      if (process.env.PLAYWRITER_UPDATE_AGENT_OUTPUT_CORPUS === '1') {
        fs.mkdirSync(CORPUS_ROOT, { recursive: true })
        fs.writeFileSync(corpusPath, markdown)
      } else {
        expect(fs.existsSync(corpusPath)).toBe(true)
      }

      if (corpusCase.diagnostics === 'hacker-news') {
        if (!context) {
          throw new Error('Playwriter corpus context is unavailable.')
        }
        const snapshotSource = await collectSnapshotSource(context, corpusCase.interactiveOnly)
        const diagnosticPath = path.join(CORPUS_ROOT, 'hacker-news-diagnostics.md')
        const diagnostics = diagnosticsMarkdown(collectHackerNewsDiagnostics(snapshotSource))
        if (process.env.PLAYWRITER_UPDATE_AGENT_OUTPUT_CORPUS === '1') {
          fs.writeFileSync(diagnosticPath, diagnostics)
        } else {
          expect(fs.existsSync(diagnosticPath)).toBe(true)
        }
      }
    }, 90_000)
  }
})
