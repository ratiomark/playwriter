import { describe, expect, it } from 'vitest'
import {
  EXECUTION_ERROR_KINDS,
  presentExecutionConsoleEvents,
  toExecutionError,
  toJsonReturnValue,
} from './execution-result.js'

describe('execution return values', () => {
  it('normalizes JSON-safe values for machine-readable consumers', () => {
    expect(toJsonReturnValue({ snapshot: '- main', logs: ['[log] ready'] })).toEqual({
      snapshot: '- main',
      logs: ['[log] ready'],
    })
  })

  it('omits values that cannot cross the JSON transport', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular

    expect(toJsonReturnValue(circular)).toBeUndefined()
    expect(toJsonReturnValue(1n)).toBeUndefined()
    expect(toJsonReturnValue(undefined)).toBeUndefined()
  })

  it('presents ordinary logs without labels and preserves event boundaries and severity', () => {
    expect(
      presentExecutionConsoleEvents([
        { method: 'log', text: '- main:\n  - heading "Example"' },
        { method: 'log', text: '{"action":"fill","value":"hello"}' },
        { method: 'warn', text: 'Fallback used' },
        { method: 'error', text: 'Request failed' },
      ]),
    ).toBe(
      '- main:\n  - heading "Example"\n' +
        '{"action":"fill","value":"hello"}\n' +
        '[warn] Fallback used\n' +
        '[error] Request failed',
    )
  })
})

describe('execution errors', () => {
  it('splits the Playwright call log out of the message', () => {
    const error = Object.assign(
      new Error("locator.click: Timeout 5000ms exceeded. Element is not enabled\nCall log:\n  - waiting for locator('#d')\n"),
      { name: 'TimeoutError', log: ["  - waiting for locator('#d')", '', '    - element is not enabled'] },
    )

    expect(toExecutionError({ error, kind: EXECUTION_ERROR_KINDS.thrown, includeStack: false, priorOutput: 'ready' })).toEqual({
      kind: 'thrown',
      name: 'TimeoutError',
      message: 'locator.click: Timeout 5000ms exceeded. Element is not enabled',
      callLog: ["  - waiting for locator('#d')", '    - element is not enabled'],
      priorOutput: 'ready',
    })
  })

  it('keeps the whole message and the stack for errors without a call log', () => {
    const error = new SyntaxError("Unexpected token ';'")
    const read = toExecutionError({ error, kind: EXECUTION_ERROR_KINDS.thrown, includeStack: true, priorOutput: '' })

    expect(read).toMatchObject({ name: 'SyntaxError', message: "Unexpected token ';'", callLog: [] })
    expect(read.stack).toContain("SyntaxError: Unexpected token ';'")
  })

  it('reads thrown non-errors as their text', () => {
    expect(toExecutionError({ error: 'boom', kind: EXECUTION_ERROR_KINDS.executionTimeout, includeStack: true, priorOutput: '' })).toEqual({
      kind: 'execution-timeout',
      name: 'Error',
      message: 'boom',
      callLog: [],
      priorOutput: '',
    })
  })
})
