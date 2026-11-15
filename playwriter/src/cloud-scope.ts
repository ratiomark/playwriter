// Exposes active cloud browsers and copies current-page cookies into one of them.

import type { Page } from '@xmorse/playwright-core'
import type { Protocol } from 'devtools-protocol'
import { getCDPSessionForPage } from './cdp-session.js'
import { CloudClient, loadCloudAuth, type CloudAuth, type CloudSessionStatus } from './cloud-client.js'
import { resolveDirectInput } from './chrome-discovery.js'
import { getChromium } from './playwright-import.js'

export interface CloudBrowserDescriptor {
  key: string
  cloudSessionId: string
  browserUseSessionId: string
  createdAt: number
  expiresAt: string
}

export interface CloudCookieTransferResult {
  browser: string
  cookieCount: number
  domains: string[]
  skipped: number
}

export interface CloudScope {
  browsers: {
    list(): Promise<CloudBrowserDescriptor[]>
  }
  sendCookies(options: {
    to: string | CloudBrowserDescriptor
    from: Page
    urls?: string[]
  }): Promise<CloudCookieTransferResult>
}

export function toCloudCookieParams({
  cookies,
  nowSeconds = Date.now() / 1000,
}: {
  cookies: Protocol.Network.Cookie[]
  nowSeconds?: number
}): { cookies: Protocol.Network.CookieParam[]; skipped: number } {
  const transferable = cookies.filter((cookie) => {
    if (cookie.partitionKeyOpaque) {
      return false
    }
    return cookie.session || cookie.expires > nowSeconds
  })

  return {
    cookies: transferable.map((cookie) => {
      return {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expires: cookie.session ? undefined : cookie.expires,
        priority: cookie.priority,
        sourceScheme: cookie.sourceScheme,
        sourcePort: cookie.sourcePort,
        partitionKey: cookie.partitionKey,
      }
    }),
    skipped: cookies.length - transferable.length,
  }
}

function getAuthenticatedCloudClient(auth: CloudAuth | undefined): CloudClient {
  const resolvedAuth = auth ?? loadCloudAuth()
  if (!resolvedAuth) {
    throw new Error('Cloud authentication is required. Run `playwriter cloud login` or set PLAYWRITER_API_KEY.')
  }
  return new CloudClient(resolvedAuth)
}

function toDescriptor(session: CloudSessionStatus): CloudBrowserDescriptor {
  return {
    key: `cloud-${session.index}`,
    cloudSessionId: session.cloudSessionId,
    browserUseSessionId: session.browserUseSessionId,
    createdAt: session.createdAt,
    expiresAt: session.timeoutAt,
  }
}

async function listCloudBrowsers({ auth }: { auth?: CloudAuth }): Promise<CloudBrowserDescriptor[]> {
  const client = getAuthenticatedCloudClient(auth)
  const { sessions } = await client.getStatus()
  return sessions.map(toDescriptor)
}

function findCloudBrowser({
  sessions,
  target,
}: {
  sessions: CloudSessionStatus[]
  target: string | CloudBrowserDescriptor
}): CloudSessionStatus {
  const id = typeof target === 'string' ? target : target.cloudSessionId
  const session = sessions.find((candidate) => {
    return `cloud-${candidate.index}` === id
      || candidate.cloudSessionId === id
      || candidate.browserUseSessionId === id
  })
  if (session) {
    return session
  }

  const available = sessions.map((candidate) => {
    return `cloud-${candidate.index}`
  })
  throw new Error(
    available.length > 0
      ? `Cloud browser "${id}" is not active. Available browsers: ${available.join(', ')}.`
      : 'No active cloud browsers. Run `playwriter session new --browser cloud` first.',
  )
}

export function resolveCloudCookieUrls({ pageUrl, urls }: { pageUrl: string; urls?: string[] }): string[] {
  const resolved = urls === undefined ? [pageUrl] : urls
  if (resolved.length === 0) {
    throw new Error('urls must contain at least one HTTP or HTTPS URL.')
  }

  return resolved.map((value) => {
    let url: URL
    try {
      url = new URL(value)
    } catch (cause) {
      throw new Error(`Invalid cookie URL: ${value}`, { cause })
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Cannot copy cookies for ${url.protocol} pages. Open an HTTP or HTTPS page first.`)
    }
    return url.toString()
  })
}

export function createCloudScope({ auth }: { auth?: CloudAuth }): CloudScope {
  return {
    browsers: {
      list: async () => {
        return listCloudBrowsers({ auth })
      },
    },
    async sendCookies({ to, from, urls }) {
      if (!from) {
        throw new Error('cloud.sendCookies requires { from: state.page }. There is no default page.')
      }
      if (from.isClosed()) {
        throw new Error('Cannot copy cookies from a closed page.')
      }

      const cookieUrls = resolveCloudCookieUrls({ pageUrl: from.url(), urls })
      const client = getAuthenticatedCloudClient(auth)
      const { sessions } = await client.getStatus()
      const target = findCloudBrowser({ sessions, target: to })
      if (!target.cdpUrl) {
        throw new Error(`Cloud browser cloud-${target.index} has no CDP URL. It may still be starting.`)
      }

      const sourceCdp = await getCDPSessionForPage({ page: from })
      const sourceCookies = await sourceCdp.send('Network.getCookies', { urls: cookieUrls })
      const converted = toCloudCookieParams({ cookies: sourceCookies.cookies })
      if (converted.cookies.length === 0) {
        return {
          browser: `cloud-${target.index}`,
          cookieCount: 0,
          domains: [],
          skipped: converted.skipped,
        }
      }

      try {
        const chromium = await getChromium()
        const browser = await chromium.connectOverCDP(await resolveDirectInput(target.cdpUrl))
        try {
          // Browser-level session: sets cookies without opening a tab in the cloud browser.
          const browserCdp = await browser.newBrowserCDPSession()
          await browserCdp.send('Storage.setCookies', { cookies: converted.cookies })
        } finally {
          await browser.close().catch(() => {})
        }
      } catch {
        // Do not retain the cause because Playwright errors can contain the credential-bearing CDP URL.
        throw new Error(`Could not send cookies to cloud-${target.index}. The cloud browser may have stopped.`)
      }

      return {
        browser: `cloud-${target.index}`,
        cookieCount: converted.cookies.length,
        domains: [...new Set(converted.cookies.map((cookie) => {
          return cookie.domain || new URL(cookie.url!).hostname
        }))].sort(),
        skipped: converted.skipped,
      }
    },
  }
}
