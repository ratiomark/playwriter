import type { Protocol } from 'devtools-protocol'
import type { BrowserContext } from '@xmorse/playwright-core'

export const AGENT_SELECTOR_ENGINE = 'agent'

const ATTR_PREFIX = 'data-agent-'
const ELEMENT_NODE = 1
const UNPRINTABLE_VALUE = /[\s"'`\\]|>>|^$/

/**
 * `agent=<role> key=value ...` matches elements whose data-agent-* attributes have these exact values,
 * skipping aria-hidden and inert subtrees. buildAgentLocators counts candidates by the same rule.
 */
export const agentSelectorEngineSource = `(() => {
  const queryAll = (root, selector) => {
    const [role, ...pairs] = selector.trim().split(/\\s+/)
    const wanted = [['role', role], ...pairs.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)])]
    return Array.from(root.querySelectorAll('[${ATTR_PREFIX}role]')).filter((element) => {
      return (
        wanted.every(([key, value]) => element.getAttribute('${ATTR_PREFIX}' + key) === value) &&
        !element.closest('[aria-hidden="true"], [inert]')
      )
    })
  }
  return { queryAll, query: (root, selector) => queryAll(root, selector)[0] || null }
})()`

type SelectorRegistry = { register(name: string, script: { content: string }): Promise<void> }

async function ignoreAlreadyRegistered(register: () => Promise<void>): Promise<void> {
  try {
    await register()
  } catch (error) {
    if (!String(error).includes('already registered')) {
      throw error
    }
  }
}

/** Covers contexts Playwright creates later, like newContext and launch. */
export async function registerAgentSelectorEngine(selectors: SelectorRegistry): Promise<void> {
  await ignoreAlreadyRegistered(() => selectors.register(AGENT_SELECTOR_ENGINE, { content: agentSelectorEngineSource }))
}

/**
 * connectOverCDP does not pass registered engines to contexts that already exist in the browser.
 * Returns the failure instead of throwing: without the engine only agent= locators stop resolving.
 */
export async function addAgentSelectorEngine(context: BrowserContext): Promise<unknown> {
  const selectorEngine = { name: AGENT_SELECTOR_ENGINE, source: agentSelectorEngineSource }
  try {
    await ignoreAlreadyRegistered(() =>
      (context as any)._channel.registerSelectorEngine({ selectorEngine }, { signal: undefined, timeout: 0 }),
    )
    return undefined
  } catch (error) {
    return error
  }
}

type AgentElement = {
  backendNodeId: Protocol.DOM.BackendNodeId
  attrs: Array<[key: string, value: string]>
}

function keyPriority(key: string): number {
  if (key === 'role') {
    return 0
  }
  if (key.endsWith('-id')) {
    return 1
  }
  if (key === 'field') {
    return 2
  }
  if (key === 'action') {
    return 3
  }
  if (key === 'scope') {
    return 4
  }
  return 5
}

function collectAgentElements(options: {
  domNodes: Protocol.DOM.Node[]
  documentBackendId: Protocol.DOM.BackendNodeId
}): AgentElement[] {
  const childrenByParent = new Map<Protocol.DOM.NodeId, Protocol.DOM.Node[]>()
  for (const node of options.domNodes) {
    if (node.parentId === undefined) {
      continue
    }
    const siblings = childrenByParent.get(node.parentId)
    if (siblings) {
      siblings.push(node)
    } else {
      childrenByParent.set(node.parentId, [node])
    }
  }

  const elements: AgentElement[] = []
  const visit = (parentId: Protocol.DOM.NodeId) => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (child.nodeType !== ELEMENT_NODE) {
        continue
      }
      const attributes: Array<[string, string]> = []
      for (let i = 0; i + 1 < (child.attributes?.length ?? 0); i += 2) {
        attributes.push([child.attributes![i]!, child.attributes![i + 1]!])
      }
      if (attributes.some(([name, value]) => name === 'inert' || (name === 'aria-hidden' && value === 'true'))) {
        continue
      }
      const attrs = attributes
        .filter(([name]) => name.startsWith(ATTR_PREFIX))
        .map(([name, value]): [string, string] => [name.slice(ATTR_PREFIX.length), value])
        .sort((a, b) => keyPriority(a[0]) - keyPriority(b[0]) || a[0].localeCompare(b[0]))
      if (attrs[0]?.[0] === 'role') {
        elements.push({ backendNodeId: child.backendNodeId, attrs })
      }
      visit(child.nodeId)
    }
  }
  const documentNode = options.domNodes.find((node) => node.backendNodeId === options.documentBackendId)
  if (documentNode) {
    visit(documentNode.nodeId)
  }
  return elements
}

/**
 * Locator per data-agent-* element: role, then attributes in priority order that each narrow the matches,
 * until it matches alone. Elements whose full attribute set repeats get `>> nth=`, which marks an app-side duplicate.
 */
export function buildAgentLocators(options: {
  domNodes: Protocol.DOM.Node[]
  documentBackendId: Protocol.DOM.BackendNodeId
}): Map<Protocol.DOM.BackendNodeId, string> {
  const elements = collectAgentElements(options)
  const matching = (attrs: AgentElement['attrs']) => {
    return elements.filter((other) => {
      return attrs.every(([key, value]) => other.attrs.some(([otherKey, otherValue]) => otherKey === key && otherValue === value))
    })
  }

  const locators = new Map<Protocol.DOM.BackendNodeId, string>()
  for (const element of elements) {
    let used = element.attrs.slice(0, 1)
    let matches = matching(used)
    for (const attr of element.attrs.slice(1)) {
      if (matches.length < 2) {
        break
      }
      const narrowed = matching([...used, attr])
      if (narrowed.length < matches.length) {
        used = [...used, attr]
        matches = narrowed
      }
    }
    if (used.some(([, value]) => UNPRINTABLE_VALUE.test(value))) {
      continue
    }
    const body = used.map(([key, value]) => (key === 'role' ? value : `${key}=${value}`)).join(' ')
    const locator = `${AGENT_SELECTOR_ENGINE}=${body}`
    locators.set(element.backendNodeId, matches.length > 1 ? `${locator} >> nth=${matches.indexOf(element)}` : locator)
  }
  return locators
}
