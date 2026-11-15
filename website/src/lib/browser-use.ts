// Typed client for Browser Use Cloud API v4.
// API reference: https://docs.browser-use.com/openapi/v4.json
// Only used server-side in the website Worker. The bu_ API key never leaves
// this process; CLI and relay only ever see the cdpUrl that comes back.

const BU_BASE = 'https://api.browser-use.com/api/v4'

/** Typed error from Browser Use API with HTTP status code.
 *  Use `error.status` to distinguish transient failures (500, 429)
 *  from confirmed-gone (404) when deciding whether to retry or delete. */
export class BrowserUseApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'BrowserUseApiError'
  }
}

export interface BrowserSession {
  id: string
  status: 'active' | 'stopped'
  cdpUrl: string | null
  liveUrl: string | null
  timeoutAt: string
  startedAt: string
  finishedAt: string | null
  proxyUsedMb: string
  proxyCost: string
  browserCost: string
  recordingUrl: string | null
}

export interface BrowserSessionList {
  items: BrowserSession[]
  totalItems: number
  pageNumber: number
  pageSize: number
}

export interface CustomProxy {
  host: string
  port: number
  username?: string
  password?: string
  ignoreCertErrors?: boolean
}

export interface CreateBrowserOptions {
  /** Country code for proxy location (195+ countries). Default null (disabled). Pass a code like 'us' to enable. */
  proxyCountryCode?: string | null
  /** Session timeout in minutes, 1-240. Default 60. */
  timeout?: number
  customProxy?: CustomProxy
  /** 320-6144 */
  browserScreenWidth?: number
  /** 320-3456 */
  browserScreenHeight?: number
  /** Default false. Reducing stealthiness. */
  allowResizing?: boolean
  /** Default false. */
  enableRecording?: boolean
}

export class BrowserUseClient {
  private apiKey: string

  constructor({ apiKey }: { apiKey: string }) {
    if (!apiKey) {
      throw new Error('BrowserUseClient requires an apiKey')
    }
    this.apiKey = apiKey
  }

  private async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${BU_BASE}${path}`
    const headers: Record<string, string> = {
      'X-Browser-Use-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new BrowserUseApiError(
        `Browser Use API error: ${response.status} ${response.statusText} — ${text}`,
        response.status,
      )
    }

    // 204 No Content (e.g. delete operations)
    if (response.status === 204) {
      return undefined as T
    }

    return response.json() as Promise<T>
  }

  /** Create a new browser VM. Returns id, cdpUrl, liveUrl, status, timeoutAt. */
  async createBrowser(options: CreateBrowserOptions = {}): Promise<BrowserSession> {
    return this.request<BrowserSession>('POST', '/browsers', {
      proxyCountryCode: options.proxyCountryCode ?? null,
      timeout: options.timeout ?? 60,
      allowResizing: options.allowResizing ?? false,
      enableRecording: options.enableRecording ?? false,
      ...(options.customProxy ? { customProxy: options.customProxy } : {}),
      ...(options.browserScreenWidth ? { browserScreenWidth: options.browserScreenWidth } : {}),
      ...(options.browserScreenHeight ? { browserScreenHeight: options.browserScreenHeight } : {}),
    })
  }

  /** Get current status of a browser VM. */
  async getBrowser(sessionId: string): Promise<BrowserSession> {
    return this.request<BrowserSession>('GET', `/browsers/${sessionId}`)
  }

  /** Stop a browser VM. Unused time is automatically refunded. */
  async stopBrowser(sessionId: string): Promise<BrowserSession> {
    return this.request<BrowserSession>('PATCH', `/browsers/${sessionId}`, {
      action: 'stop',
    })
  }

  /** List browser VMs for the account. */
  async listBrowsers(options?: {
    pageSize?: number
    pageNumber?: number
    filterBy?: 'active' | 'stopped'
  }): Promise<BrowserSessionList> {
    const params = new URLSearchParams()
    if (options?.pageSize) {
      params.set('pageSize', String(options.pageSize))
    }
    if (options?.pageNumber) {
      params.set('pageNumber', String(options.pageNumber))
    }
    if (options?.filterBy) {
      params.set('filterBy', options.filterBy)
    }
    const query = params.toString()
    const path = query ? `/browsers?${query}` : '/browsers'
    return this.request<BrowserSessionList>('GET', path)
  }
}
