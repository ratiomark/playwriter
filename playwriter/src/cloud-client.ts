// HTTP client for CLI to call the website's /api/cloud/* routes.
// Auth token is stored in ~/.playwriter/auth.json by `cloud login`.
// Falls back to PLAYWRITER_CLOUD_TOKEN env var for CI.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_BASE_URL = 'https://playwriter.dev'
const AUTH_FILE = path.join(os.homedir(), '.playwriter', 'auth.json')

// ── Auth persistence ────────────────────────────────────────────────

export interface CloudAuth {
  token: string
  baseUrl: string
}

export function loadCloudAuth(): CloudAuth | null {
  // Env var takes priority (for CI and agents)
  const envToken = process.env.PLAYWRITER_CLOUD_TOKEN
  if (envToken) {
    return { token: envToken, baseUrl: process.env.PLAYWRITER_CLOUD_URL || DEFAULT_BASE_URL }
  }
  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'))
    if (data.token) {
      return { token: data.token, baseUrl: data.baseUrl || DEFAULT_BASE_URL }
    }
  } catch {
    // No auth file
  }
  return null
}

export function saveCloudAuth(auth: CloudAuth): void {
  const dir = path.dirname(AUTH_FILE)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

// ── Cloud session status types ───────────────────────────────────────

export interface CloudSessionStatus {
  cloudSessionId: string
  browserUseSessionId: string
  index: number
  createdAt: number
  status: 'active' | 'stopped'
  cdpUrl: string | null
  liveUrl: string | null
  timeoutAt: string
}

export interface ConnectResult {
  cloudSessionId: string
  cdpUrl: string | null
  liveUrl: string | null
  /** BU VM hard timeout (ISO string from server) */
  timeoutAt?: string
}

// ── Client ──────────────────────────────────────────────────────────

export class CloudClient {
  private baseUrl: string
  private token: string

  constructor(auth: CloudAuth) {
    this.baseUrl = auth.baseUrl
    this.token = auth.token
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl).toString()
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (response.status === 401) {
      throw new Error('Cloud auth expired or invalid. Run `playwriter cloud login` again.')
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let detail = text
      try {
        const json = JSON.parse(text)
        detail = json.error || json.message || text
      } catch {
        // use raw text
      }
      throw new Error(`Cloud API error: ${response.status} — ${detail}`)
    }

    return response.json() as Promise<T>
  }

  async getStatus(): Promise<{ sessions: CloudSessionStatus[] }> {
    return this.request('GET', '/api/cloud/status')
  }

  async connect(options: {
    proxyRegion?: string
    customProxy?: { host: string; port: number; username?: string; password?: string }
    /** Cloud browser timeout in minutes (1-240, default 60) */
    timeout?: number
  }): Promise<ConnectResult> {
    return this.request('POST', '/api/cloud/connect', {
      proxyRegion: options.proxyRegion,
      customProxy: options.customProxy,
      ...(options.timeout ? { timeout: options.timeout } : {}),
    })
  }

  async disconnect(cloudSessionId: string): Promise<void> {
    await this.request('POST', '/api/cloud/disconnect', { cloudSessionId })
  }

  /** Get a single session's status by cloudSessionId (from the status list). */
  async getSessionStatus(cloudSessionId: string): Promise<CloudSessionStatus | null> {
    const { sessions } = await this.getStatus()
    return sessions.find((s) => {
      return s.cloudSessionId === cloudSessionId
    }) ?? null
  }
}

/** Create a CloudClient from saved auth, or null if not logged in. */
export function getCloudClient(): CloudClient | null {
  const auth = loadCloudAuth()
  if (!auth) return null
  return new CloudClient(auth)
}
