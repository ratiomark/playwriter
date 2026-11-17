import { describe, expect, it } from 'vitest'
import type { Protocol } from 'devtools-protocol'
import {
  buildRawSnapshotTree,
  buildRoleLocatorMatches,
  buildRoleQueryOrder,
  buildSnapshotLines,
  filterFullSnapshotTree,
  filterInteractiveSnapshotTree,
  finalizeSnapshotOutput,
  removeIgnoredIndentOffsets,
  type SnapshotNode,
} from './aria-snapshot.js'

const roleValue = (value: string): Protocol.Accessibility.AXValue => {
  return { type: 'role', value }
}

const nameValue = (value: string): Protocol.Accessibility.AXValue => {
  return { type: 'string', value }
}

describe('aria-snapshot tree filters', () => {
  it('removes only indentation from ignored wrappers', () => {
    const nodes: SnapshotNode[] = [
      {
        role: 'form',
        name: 'Account',
        indentOffset: 3,
        children: [
          {
            role: 'textbox',
            name: 'Email',
            indentOffset: 2,
            children: [],
          },
        ],
      },
      {
        role: 'button',
        name: 'Save',
        indentOffset: 5,
        children: [],
      },
    ]

    const normalized = removeIgnoredIndentOffsets(nodes)

    expect(
      buildSnapshotLines(normalized)
        .map((line) => line.text)
        .join('\n'),
    ).toBe('form "Account"\n textbox "Email"\nbutton "Save"')
    expect(normalized).toEqual([
      {
        role: 'form',
        name: 'Account',
        children: [{ role: 'textbox', name: 'Email', children: [] }],
      },
      { role: 'button', name: 'Save', children: [] },
    ])
  })

  it('builds a raw snapshot tree with scope pruning', () => {
    const rootId = '1' as Protocol.Accessibility.AXNodeId
    const mainId = '2' as Protocol.Accessibility.AXNodeId
    const navId = '3' as Protocol.Accessibility.AXNodeId
    const listId = '4' as Protocol.Accessibility.AXNodeId
    const listItemId = '5' as Protocol.Accessibility.AXNodeId
    const linkId = '6' as Protocol.Accessibility.AXNodeId
    const headingId = '7' as Protocol.Accessibility.AXNodeId
    const buttonId = '8' as Protocol.Accessibility.AXNodeId

    const axById = new Map<Protocol.Accessibility.AXNodeId, Protocol.Accessibility.AXNode>([
      [
        rootId,
        {
          nodeId: rootId,
          ignored: false,
          role: roleValue('rootwebarea'),
          childIds: [mainId, navId],
        },
      ],
      [
        mainId,
        {
          nodeId: mainId,
          ignored: false,
          role: roleValue('main'),
          childIds: [headingId, buttonId],
          backendDOMNodeId: 200 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        navId,
        {
          nodeId: navId,
          ignored: false,
          role: roleValue('navigation'),
          childIds: [listId],
          backendDOMNodeId: 201 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        listId,
        {
          nodeId: listId,
          ignored: false,
          role: roleValue('list'),
          childIds: [listItemId],
          backendDOMNodeId: 202 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        listItemId,
        {
          nodeId: listItemId,
          ignored: false,
          role: roleValue('listitem'),
          childIds: [linkId],
          backendDOMNodeId: 203 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        linkId,
        {
          nodeId: linkId,
          ignored: false,
          role: roleValue('link'),
          name: nameValue('Docs'),
          backendDOMNodeId: 204 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        headingId,
        {
          nodeId: headingId,
          ignored: false,
          role: roleValue('heading'),
          name: nameValue('Title'),
          backendDOMNodeId: 205 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        buttonId,
        {
          nodeId: buttonId,
          ignored: false,
          role: roleValue('button'),
          name: nameValue('Submit'),
          backendDOMNodeId: 206 as Protocol.DOM.BackendNodeId,
        },
      ],
    ])

    const allowed = new Set<Protocol.DOM.BackendNodeId>([204 as Protocol.DOM.BackendNodeId])
    const isNodeInScope = (node: Protocol.Accessibility.AXNode): boolean => {
      return Boolean(node.backendDOMNodeId && allowed.has(node.backendDOMNodeId))
    }

    const rawTree = buildRawSnapshotTree({ nodeId: rootId, axById, isNodeInScope })
    expect(rawTree).toMatchInlineSnapshot(`
      {
        "backendNodeId": undefined,
        "children": [
          {
            "backendNodeId": 201,
            "children": [
              {
                "backendNodeId": 202,
                "children": [
                  {
                    "backendNodeId": 203,
                    "children": [
                      {
                        "backendNodeId": 204,
                        "children": [],
                        "ignored": false,
                        "name": "Docs",
                        "role": "link",
                        "state": undefined,
                      },
                    ],
                    "ignored": false,
                    "name": "",
                    "role": "listitem",
                    "state": undefined,
                  },
                ],
                "ignored": false,
                "name": "",
                "role": "list",
                "state": undefined,
              },
            ],
            "ignored": false,
            "name": "",
            "role": "navigation",
            "state": undefined,
          },
        ],
        "ignored": false,
        "name": "",
        "role": "rootwebarea",
        "state": undefined,
      }
    `)
  })

  it('filters interactive-only trees with labels and wrapper hoisting', () => {
    const rawTree: SnapshotNode = {
      role: 'main',
      name: '',
      ignored: false,
      children: [
        {
          role: 'navigation',
          name: '',
          ignored: false,
          children: [{ role: 'link', name: 'Home', backendNodeId: 2 as Protocol.DOM.BackendNodeId, children: [] }],
        },
        {
          role: 'labeltext',
          name: '',
          ignored: false,
          children: [{ role: 'statictext', name: 'Email', ignored: false, children: [] }],
        },
        {
          role: 'generic',
          name: '',
          ignored: false,
          children: [{ role: 'button', name: 'Save', backendNodeId: 1 as Protocol.DOM.BackendNodeId, children: [] }],
        },
        {
          role: 'generic',
          name: 'Wrapper',
          ignored: false,
          children: [
            { role: 'statictext', name: 'Wrapper', ignored: false, children: [] },
            { role: 'statictext', name: 'Hint', ignored: false, children: [] },
          ],
        },
        {
          role: 'generic',
          name: '',
          ignored: true,
          children: [
            { role: 'button', name: 'Ignored Action', backendNodeId: 3 as Protocol.DOM.BackendNodeId, children: [] },
          ],
        },
        { role: 'heading', name: 'Settings', ignored: false, children: [] },
      ],
    }

    const domByBackendId = new Map<
      Protocol.DOM.BackendNodeId,
      {
        nodeId: Protocol.DOM.NodeId
        parentId?: Protocol.DOM.NodeId
        backendNodeId: Protocol.DOM.BackendNodeId
        nodeName: string
        attributes: Map<string, string>
      }
    >([
      [
        1 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 10 as Protocol.DOM.NodeId,
          backendNodeId: 1 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'save-btn']]),
        },
      ],
      [
        2 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 11 as Protocol.DOM.NodeId,
          backendNodeId: 2 as Protocol.DOM.BackendNodeId,
          nodeName: 'A',
          attributes: new Map([['data-testid', 'nav-home']]),
        },
      ],
      [
        3 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 12 as Protocol.DOM.NodeId,
          backendNodeId: 3 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'ignored-action']]),
        },
      ],
    ])

    let refCounter = 0
    const createRefForNode = (options: {
      backendNodeId?: Protocol.DOM.BackendNodeId
      role: string
      name: string
    }): string => {
      refCounter += 1
      return `${options.role}-${options.name}-${refCounter}`
    }

    const filtered = filterInteractiveSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      labelContext: false,
      domByBackendId,
      createRefForNode,
    })

    expect(filtered).toMatchInlineSnapshot(`
      {
        "names": Set {
          "Home",
          "Email",
          "Save",
          "Ignored Action",
        },
        "nodes": [
          {
            "backendNodeId": undefined,
            "baseLocator": undefined,
            "children": [
              {
                "backendNodeId": undefined,
                "baseLocator": undefined,
                "children": [
                  {
                    "backendNodeId": 2,
                    "baseLocator": "[data-testid="nav-home"]",
                    "children": [],
                    "name": "Home",
                    "ref": "link-Home-1",
                    "role": "link",
                    "state": undefined,
                  },
                ],
                "name": "",
                "ref": undefined,
                "role": "navigation",
                "state": undefined,
              },
              {
                "backendNodeId": undefined,
                "baseLocator": undefined,
                "children": [
                  {
                    "children": [],
                    "name": "Email",
                    "role": "text",
                  },
                ],
                "name": "",
                "ref": undefined,
                "role": "labeltext",
                "state": undefined,
              },
              {
                "backendNodeId": 1,
                "baseLocator": "[id="save-btn"]",
                "children": [],
                "name": "Save",
                "ref": "button-Save-2",
                "role": "button",
                "state": undefined,
              },
              {
                "backendNodeId": 3,
                "baseLocator": "[id="ignored-action"]",
                "children": [],
                "indentOffset": 1,
                "name": "Ignored Action",
                "ref": "button-Ignored Action-3",
                "role": "button",
                "state": undefined,
              },
            ],
            "name": "",
            "ref": undefined,
            "role": "main",
            "state": undefined,
          },
        ],
      }
    `)
  })

  it('generates locator output for full snapshot trees', () => {
    const rawTree: SnapshotNode = {
      role: 'form',
      name: 'Account',
      ignored: false,
      children: [
        { role: 'textbox', name: 'Email', backendNodeId: 2 as Protocol.DOM.BackendNodeId, children: [] },
        {
          role: 'group',
          name: '',
          ignored: false,
          children: [
            { role: 'button', name: 'Save', backendNodeId: 3 as Protocol.DOM.BackendNodeId, children: [] },
            { role: 'button', name: 'Save', backendNodeId: 4 as Protocol.DOM.BackendNodeId, children: [] },
          ],
        },
      ],
    }

    const domByBackendId = new Map<
      Protocol.DOM.BackendNodeId,
      {
        nodeId: Protocol.DOM.NodeId
        parentId?: Protocol.DOM.NodeId
        backendNodeId: Protocol.DOM.BackendNodeId
        nodeName: string
        attributes: Map<string, string>
      }
    >([
      [
        2 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 20 as Protocol.DOM.NodeId,
          backendNodeId: 2 as Protocol.DOM.BackendNodeId,
          nodeName: 'INPUT',
          attributes: new Map([['data-testid', 'email-input']]),
        },
      ],
      [
        3 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 21 as Protocol.DOM.NodeId,
          backendNodeId: 3 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'save-primary']]),
        },
      ],
      [
        4 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 22 as Protocol.DOM.NodeId,
          backendNodeId: 4 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'save-secondary']]),
        },
      ],
    ])

    let refCounter = 0
    const createRefForNode = (): string => {
      refCounter += 1
      return `e${refCounter}`
    }

    const filtered = filterFullSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      domByBackendId,
      createRefForNode,
    })

    const lines = buildSnapshotLines(filtered.nodes)
    const result = finalizeSnapshotOutput(lines, filtered.nodes, new Map())
    expect(result.snapshot).toMatchInlineSnapshot(`
      "form "Account":
       textbox "Email" [data-testid="email-input"]
       button "Save" [id="save-primary"]
       button "Save" [id="save-secondary"]"
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "snapshot": "form "Account":
       textbox "Email" [data-testid="email-input"]
       button "Save" [id="save-primary"]
       button "Save" [id="save-secondary"]",
        "tree": [
          {
            "backendNodeId": undefined,
            "children": [
              {
                "backendNodeId": 2,
                "children": [],
                "locator": "[data-testid="email-input"]",
                "name": "Email",
                "ref": "e1",
                "role": "textbox",
                "shortRef": "e1",
              },
              {
                "backendNodeId": 3,
                "children": [],
                "locator": "[id="save-primary"]",
                "name": "Save",
                "ref": "e2",
                "role": "button",
                "shortRef": "e2",
              },
              {
                "backendNodeId": 4,
                "children": [],
                "locator": "[id="save-secondary"]",
                "name": "Save",
                "ref": "e3",
                "role": "button",
                "shortRef": "e3",
              },
            ],
            "locator": undefined,
            "name": "Account",
            "ref": undefined,
            "role": "form",
            "shortRef": undefined,
          },
        ],
      }
    `)
  })

  it('drops redundant text and preserves named wrappers in full snapshots', () => {
    const rawTree: SnapshotNode = {
      role: 'section',
      name: 'Billing',
      ignored: false,
      children: [
        {
          role: 'generic',
          name: 'Card',
          ignored: false,
          children: [
            { role: 'statictext', name: 'Card', ignored: false, children: [] },
            { role: 'statictext', name: 'Card number', ignored: false, children: [] },
          ],
        },
      ],
    }

    const domByBackendId = new Map<
      Protocol.DOM.BackendNodeId,
      {
        nodeId: Protocol.DOM.NodeId
        parentId?: Protocol.DOM.NodeId
        backendNodeId: Protocol.DOM.BackendNodeId
        nodeName: string
        attributes: Map<string, string>
      }
    >()

    const createRefForNode = (): string | null => {
      return null
    }

    const filtered = filterFullSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      domByBackendId,
      createRefForNode,
    })

    expect(filtered).toMatchInlineSnapshot(`
      {
        "names": Set {
          "Card",
          "Billing",
        },
        "nodes": [
          {
            "backendNodeId": undefined,
            "baseLocator": undefined,
            "children": [
              {
                "backendNodeId": undefined,
                "baseLocator": undefined,
                "children": [],
                "name": "Card",
                "ref": undefined,
                "role": "generic",
                "state": undefined,
              },
            ],
            "name": "Billing",
            "ref": undefined,
            "role": "section",
            "state": undefined,
          },
        ],
      }
    `)
  })

  it('respects refFilter in interactive-only snapshots', () => {
    const rawTree: SnapshotNode = {
      role: 'main',
      name: '',
      ignored: false,
      children: [
        { role: 'button', name: 'Delete', backendNodeId: 5 as Protocol.DOM.BackendNodeId, children: [] },
        { role: 'button', name: 'Save', backendNodeId: 6 as Protocol.DOM.BackendNodeId, children: [] },
      ],
    }

    const domByBackendId = new Map<
      Protocol.DOM.BackendNodeId,
      {
        nodeId: Protocol.DOM.NodeId
        parentId?: Protocol.DOM.NodeId
        backendNodeId: Protocol.DOM.BackendNodeId
        nodeName: string
        attributes: Map<string, string>
      }
    >([
      [
        5 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 30 as Protocol.DOM.NodeId,
          backendNodeId: 5 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'delete']]),
        },
      ],
      [
        6 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 31 as Protocol.DOM.NodeId,
          backendNodeId: 6 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'save']]),
        },
      ],
    ])

    let refCounter = 0
    const createRefForNode = (): string => {
      refCounter += 1
      return `e${refCounter}`
    }

    const filtered = filterInteractiveSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      labelContext: false,
      domByBackendId,
      createRefForNode,
      refFilter: ({ name }) => name !== 'Delete',
    })

    expect(filtered).toMatchInlineSnapshot(`
      {
        "names": Set {
          "Save",
        },
        "nodes": [
          {
            "backendNodeId": undefined,
            "baseLocator": undefined,
            "children": [
              {
                "backendNodeId": 6,
                "baseLocator": "[id="save"]",
                "children": [],
                "name": "Save",
                "ref": "e1",
                "role": "button",
                "state": undefined,
              },
            ],
            "name": "",
            "ref": undefined,
            "role": "main",
            "state": undefined,
          },
        ],
      }
    `)
  })

  it('renders element state from AX properties', () => {
    const prop = (name: string, type: Protocol.Accessibility.AXValueType, value: unknown) => {
      return { name, value: { type, value } } as Protocol.Accessibility.AXProperty
    }
    const axNodes: Protocol.Accessibility.AXNode[] = [
      { nodeId: '1', ignored: false, role: roleValue('main'), childIds: ['2', '3', '4', '5', '6', '7'] },
      {
        nodeId: '2',
        ignored: false,
        role: roleValue('heading'),
        name: nameValue('Settings'),
        properties: [prop('level', 'integer', 2)],
      },
      {
        nodeId: '3',
        ignored: false,
        role: roleValue('checkbox'),
        name: nameValue('Alerts'),
        backendDOMNodeId: 3 as Protocol.DOM.BackendNodeId,
        properties: [prop('checked', 'tristate', 'true'), prop('disabled', 'boolean', true)],
      },
      {
        nodeId: '4',
        ignored: false,
        role: roleValue('checkbox'),
        name: nameValue('All'),
        backendDOMNodeId: 4 as Protocol.DOM.BackendNodeId,
        properties: [prop('checked', 'tristate', 'mixed')],
      },
      {
        nodeId: '5',
        ignored: false,
        role: roleValue('button'),
        name: nameValue('Menu'),
        backendDOMNodeId: 5 as Protocol.DOM.BackendNodeId,
        properties: [prop('expanded', 'booleanOrUndefined', true)],
      },
      {
        nodeId: '6',
        ignored: false,
        role: roleValue('tab'),
        name: nameValue('Profile'),
        backendDOMNodeId: 6 as Protocol.DOM.BackendNodeId,
        properties: [prop('selected', 'booleanOrUndefined', true)],
      },
      {
        nodeId: '7',
        ignored: false,
        role: roleValue('listitem'),
        name: nameValue('Collapsed'),
        properties: [prop('level', 'integer', 1), prop('expanded', 'booleanOrUndefined', false)],
      },
    ]
    const axById = new Map(axNodes.map((node) => [node.nodeId, node]))
    const rawTree = buildRawSnapshotTree({ nodeId: '1', axById, isNodeInScope: () => true })!
    const domByBackendId = new Map([
      [
        3 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 30 as Protocol.DOM.NodeId,
          backendNodeId: 3 as Protocol.DOM.BackendNodeId,
          nodeName: 'INPUT',
          attributes: new Map([['id', 'alerts']]),
        },
      ],
    ])
    let refCounter = 0
    const filtered = filterFullSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      domByBackendId,
      createRefForNode: () => `e${++refCounter}`,
    })
    const result = finalizeSnapshotOutput(buildSnapshotLines(filtered.nodes), filtered.nodes, new Map())
    expect(result.snapshot).toMatchInlineSnapshot(`
      "main:
       heading "Settings" [level=2]
       checkbox "Alerts" [checked] [disabled] [id="alerts"]
       [checked=mixed] role=checkbox[name="All"i]
       [expanded] role=button[name="Menu"i]
       [selected] role=tab[name="Profile"i]
       listitem "Collapsed""
    `)
  })
})

describe('role locator nth', () => {
  const axNodes: Protocol.Accessibility.AXNode[] = [
    { nodeId: '1', ignored: false, role: roleValue('RootWebArea'), childIds: ['2', '3', '4', '5'] },
    { nodeId: '2', ignored: false, role: roleValue('button'), name: nameValue('Home'), backendDOMNodeId: 2 as Protocol.DOM.BackendNodeId },
    { nodeId: '3', ignored: true, role: roleValue('button'), name: nameValue('Hidden'), backendDOMNodeId: 3 as Protocol.DOM.BackendNodeId },
    { nodeId: '4', ignored: false, role: roleValue('button'), name: nameValue('save'), backendDOMNodeId: 4 as Protocol.DOM.BackendNodeId },
    { nodeId: '5', ignored: false, role: roleValue('region'), name: nameValue('Panel'), backendDOMNodeId: 5 as Protocol.DOM.BackendNodeId, childIds: ['6', '7'] },
    { nodeId: '6', ignored: false, role: roleValue('button'), name: nameValue('Save'), backendDOMNodeId: 6 as Protocol.DOM.BackendNodeId },
    { nodeId: '7', ignored: false, role: roleValue('button'), backendDOMNodeId: 7 as Protocol.DOM.BackendNodeId },
  ]
  const axById = new Map(axNodes.map((node) => [node.nodeId, node]))
  const render = (rootNodeId: string) => {
    const rawTree = buildRawSnapshotTree({ nodeId: rootNodeId, axById, isNodeInScope: () => true })!
    const filtered = filterFullSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      domByBackendId: new Map(),
      createRefForNode: () => null,
    })
    const queryOrder = new Map([2, 3, 4, 5, 6, 7].map((backendNodeId, index) => [backendNodeId, index]))
    const roleLocatorMatches = buildRoleLocatorMatches({ rootNodeId: '1', axById, excludedBackendIds: new Set(), queryOrder })
    return finalizeSnapshotOutput(buildSnapshotLines(filtered.nodes), filtered.nodes, new Map(), roleLocatorMatches).snapshot
  }

  it('counts unnamed role locators against every element of that role in the frame', () => {
    expect(render('5')).toMatchInlineSnapshot(`
      "region "Panel":
       role=button[name="Save"i] >> nth=1
       role=button >> nth=3"
    `)
  })
})

describe('role query order', () => {
  const domNode = (node: Partial<Protocol.DOM.Node> & Pick<Protocol.DOM.Node, 'nodeId' | 'backendNodeId'>): Protocol.DOM.Node => {
    return { nodeType: 1, nodeName: 'DIV', localName: 'div', nodeValue: '', ...node }
  }
  const shadowRoot = (nodeId: number, backendNodeId: number, shadowRootType: Protocol.DOM.ShadowRootType) => {
    return domNode({ nodeId, backendNodeId, nodeType: 11, nodeName: '#document-fragment', localName: '', shadowRootType })
  }
  const domNodes: Protocol.DOM.Node[] = [
    domNode({ nodeId: 50, parentId: 41, backendNodeId: 11, nodeName: 'BUTTON' }),
    domNode({ nodeId: 40, parentId: 30, backendNodeId: 10, shadowRoots: [shadowRoot(41, 13, 'open')] }),
    domNode({ nodeId: 51, parentId: 43, backendNodeId: 15, nodeName: 'BUTTON' }),
    domNode({ nodeId: 44, parentId: 30, backendNodeId: 14, shadowRoots: [shadowRoot(43, 16, 'closed')] }),
    domNode({ nodeId: 60, parentId: 61, backendNodeId: 17, nodeName: 'BUTTON' }),
    domNode({ nodeId: 61, parentId: 45, backendNodeId: 18, nodeType: 9, nodeName: '#document' }),
    domNode({ nodeId: 45, parentId: 30, backendNodeId: 19, nodeName: 'IFRAME' }),
    domNode({ nodeId: 42, parentId: 30, backendNodeId: 12, nodeName: 'BUTTON' }),
    domNode({ nodeId: 30, parentId: 1, backendNodeId: 20, nodeName: 'BODY' }),
    domNode({ nodeId: 1, backendNodeId: 100, nodeType: 9, nodeName: '#document' }),
  ]

  it('visits light DOM before open shadow roots and skips closed roots and child frames', () => {
    const order = buildRoleQueryOrder({ domNodes, documentBackendId: 100 })
    expect([...order.keys()]).toEqual([20, 10, 14, 19, 12, 11])
  })

  it('numbers role locators in Playwright order when shadow content comes first in AX tree', () => {
    const axNodes: Protocol.Accessibility.AXNode[] = [
      { nodeId: '1', ignored: false, role: roleValue('main'), backendDOMNodeId: 100, childIds: ['2', '4'] },
      { nodeId: '2', ignored: false, role: roleValue('generic'), backendDOMNodeId: 10, childIds: ['3'] },
      { nodeId: '3', ignored: false, role: roleValue('button'), name: nameValue('Save'), backendDOMNodeId: 11 },
      { nodeId: '4', ignored: false, role: roleValue('button'), name: nameValue('Save'), backendDOMNodeId: 12 },
    ]
    const axById = new Map(axNodes.map((node) => [node.nodeId, node]))
    const rawTree = buildRawSnapshotTree({ nodeId: '1', axById, isNodeInScope: () => true })!
    const filtered = filterFullSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      domByBackendId: new Map(),
      createRefForNode: () => null,
    })
    const roleLocatorMatches = buildRoleLocatorMatches({
      rootNodeId: '1',
      axById,
      excludedBackendIds: new Set(),
      queryOrder: buildRoleQueryOrder({ domNodes, documentBackendId: 100 }),
    })
    expect(finalizeSnapshotOutput(buildSnapshotLines(filtered.nodes), filtered.nodes, new Map(), roleLocatorMatches).snapshot)
      .toMatchInlineSnapshot(`
        "main:
         role=button[name="Save"i] >> nth=1
         role=button[name="Save"i] >> nth=0"
      `)
  })
})

describe('wrapper names', () => {
  const computedName = (value: string, sources: Protocol.Accessibility.AXValueSource[]): Protocol.Accessibility.AXValue => {
    return { type: 'computedString', value, sources }
  }
  const axNodes: Protocol.Accessibility.AXNode[] = [
    { nodeId: '1', ignored: false, role: roleValue('main'), childIds: ['2', '5'] },
    {
      nodeId: '2',
      ignored: false,
      role: roleValue('generic'),
      name: computedName('Flow alpha Edit flow', [
        { type: 'attribute', attribute: 'aria-label' },
        { type: 'contents', value: nameValue('Flow alpha Edit flow') },
      ]),
      childIds: ['3', '4'],
    },
    { nodeId: '3', ignored: false, role: roleValue('StaticText'), name: nameValue('Flow alpha') },
    { nodeId: '4', ignored: false, role: roleValue('button'), name: nameValue('Edit flow') },
    {
      nodeId: '5',
      ignored: false,
      role: roleValue('generic'),
      name: computedName('Labelled panel', [
        { type: 'attribute', attribute: 'aria-label', value: nameValue('Labelled panel') },
        { type: 'contents', superseded: true, value: nameValue('Panel text') },
      ]),
      childIds: ['6'],
    },
    { nodeId: '6', ignored: false, role: roleValue('StaticText'), name: nameValue('Panel text') },
  ]
  const axById = new Map(axNodes.map((node) => [node.nodeId, node]))

  it('ignores names wrappers get from their contents and keeps authored ones', () => {
    const rawTree = buildRawSnapshotTree({ nodeId: '1', axById, isNodeInScope: () => true })!
    const filtered = filterFullSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      domByBackendId: new Map(),
      createRefForNode: () => null,
    })
    expect(finalizeSnapshotOutput(buildSnapshotLines(filtered.nodes), filtered.nodes, new Map()).snapshot)
      .toMatchInlineSnapshot(`
        "main:
         text: "Flow alpha"
         role=button[name="Edit flow"i]
         generic "Labelled panel":
          text: "Panel text""
      `)
  })
})
