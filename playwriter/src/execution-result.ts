export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const EXECUTION_CONSOLE_METHODS = {
  debug: 'debug',
  error: 'error',
  info: 'info',
  log: 'log',
  warn: 'warn',
} as const

export type ExecutionConsoleMethod = (typeof EXECUTION_CONSOLE_METHODS)[keyof typeof EXECUTION_CONSOLE_METHODS]

export interface ExecutionConsoleEvent {
  readonly method: ExecutionConsoleMethod
  readonly text: string
}

export function isExecutionConsoleMethod(value: unknown): value is ExecutionConsoleMethod {
  return typeof value === 'string' && Object.values(EXECUTION_CONSOLE_METHODS).some((method) => method === value)
}

export function toJsonReturnValue(value: unknown): JsonValue | undefined {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      return undefined
    }
    const parsed: JsonValue = JSON.parse(serialized)
    return parsed
  } catch {
    return undefined
  }
}

export function presentExecutionConsoleEvents(events: readonly ExecutionConsoleEvent[]): string {
  return events
    .map((event) => {
      const text = event.text.replace(/(?:\r?\n)+$/u, '')
      return event.method === EXECUTION_CONSOLE_METHODS.log ? text : `[${event.method}] ${text}`
    })
    .join('\n\n')
}
