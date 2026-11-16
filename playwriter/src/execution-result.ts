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
    .join('\n')
}

export const EXECUTION_ERROR_KINDS = {
  /** The whole execution exceeded its timeout. */
  executionTimeout: 'execution-timeout',
  /** The caller cancelled the execution. */
  cancelled: 'cancelled',
  /** The executed code threw. */
  thrown: 'thrown',
} as const

export type ExecutionErrorKind = (typeof EXECUTION_ERROR_KINDS)[keyof typeof EXECUTION_ERROR_KINDS]

/** Failed execution for structured consumers; text and agentText keep the human form. */
export interface ExecutionError {
  readonly kind: ExecutionErrorKind
  readonly name: string
  /** Message without the Playwright call log. */
  readonly message: string
  /** Playwright action log lines; empty when the error didn't come from a Playwright call. */
  readonly callLog: readonly string[]
  /** Raw stack; omitted for timeouts, whose stacks are internal. */
  readonly stack?: string
  /** Output the code produced before it failed, as agentText presents it. */
  readonly priorOutput: string
}

/** Playwright appends the call log to the message after this header; consumers get it as callLog instead. */
const PLAYWRIGHT_CALL_LOG_HEADER = '\nCall log:\n'

export function toExecutionError({
  error,
  kind,
  includeStack,
  priorOutput,
}: {
  error: unknown
  kind: ExecutionErrorKind
  includeStack: boolean
  priorOutput: string
}): ExecutionError {
  const fullMessage = error instanceof Error ? error.message : String(error)
  const callLog = readCallLog(error)
  const headerIndex = callLog.length > 0 ? fullMessage.indexOf(PLAYWRIGHT_CALL_LOG_HEADER) : -1
  const stack = includeStack && error instanceof Error ? error.stack : undefined
  return {
    kind,
    name: error instanceof Error ? error.name : 'Error',
    message: (headerIndex === -1 ? fullMessage : fullMessage.slice(0, headerIndex)).trim(),
    callLog,
    ...(stack ? { stack } : {}),
    priorOutput,
  }
}

/** Playwright errors carry the action log as `log`; other errors have none. */
function readCallLog(error: unknown): string[] {
  if (typeof error !== 'object' || error === null || !('log' in error) || !Array.isArray(error.log)) {
    return []
  }
  return error.log.filter((line): line is string => typeof line === 'string' && line.length > 0)
}
