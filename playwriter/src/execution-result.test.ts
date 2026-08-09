import { describe, expect, it } from 'vitest'
import { presentExecutionConsoleEvents, toJsonReturnValue } from './execution-result.js'

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
      '- main:\n  - heading "Example"\n\n' +
        '{"action":"fill","value":"hello"}\n\n' +
        '[warn] Fallback used\n\n' +
        '[error] Request failed',
    )
  })
})
