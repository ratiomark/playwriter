// Tests cookie conversion before values are sent to a cloud browser.

import { describe, expect, test } from 'vitest'
import type { Protocol } from 'devtools-protocol'
import { resolveCloudCookieUrls, toCloudCookieParams } from './cloud-scope.js'

function cookie(overrides: Partial<Protocol.Network.Cookie> = {}): Protocol.Network.Cookie {
  return {
    name: 'session',
    value: 'secret',
    domain: '.example.com',
    path: '/',
    expires: -1,
    size: 13,
    httpOnly: true,
    secure: true,
    session: true,
    priority: 'High',
    sourceScheme: 'Secure',
    sourcePort: 443,
    ...overrides,
  }
}

describe('resolveCloudCookieUrls', () => {
  test('defaults to the current page URL', () => {
    expect(resolveCloudCookieUrls({ pageUrl: 'https://example.com/account?tab=profile' })).toMatchInlineSnapshot(`
      [
        "https://example.com/account?tab=profile",
      ]
    `)
  })

  test('uses explicit URLs when provided', () => {
    expect(resolveCloudCookieUrls({
      pageUrl: 'https://example.com/account',
      urls: ['https://example.com', 'https://api.example.com/login'],
    })).toMatchInlineSnapshot(`
      [
        "https://example.com/",
        "https://api.example.com/login",
      ]
    `)
  })
})

describe('toCloudCookieParams', () => {
  test('preserves current-page cookie attributes', () => {
    const result = toCloudCookieParams({
      cookies: [
        cookie({ sameSite: 'None' }),
        cookie({
          name: 'partitioned',
          partitionKey: {
            topLevelSite: 'https://example.com',
            hasCrossSiteAncestor: false,
          },
        }),
      ],
      nowSeconds: 1_800_000_000,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "cookies": [
          {
            "domain": ".example.com",
            "expires": undefined,
            "httpOnly": true,
            "name": "session",
            "partitionKey": undefined,
            "path": "/",
            "priority": "High",
            "sameSite": "None",
            "secure": true,
            "sourcePort": 443,
            "sourceScheme": "Secure",
            "value": "secret",
          },
          {
            "domain": ".example.com",
            "expires": undefined,
            "httpOnly": true,
            "name": "partitioned",
            "partitionKey": {
              "hasCrossSiteAncestor": false,
              "topLevelSite": "https://example.com",
            },
            "path": "/",
            "priority": "High",
            "sameSite": undefined,
            "secure": true,
            "sourcePort": 443,
            "sourceScheme": "Secure",
            "value": "secret",
          },
        ],
        "skipped": 0,
      }
    `)
  })

  test('skips expired cookies and opaque partition keys', () => {
    const result = toCloudCookieParams({
      cookies: [
        cookie({ name: 'expired', session: false, expires: 1_700_000_000 }),
        cookie({ name: 'opaque', partitionKeyOpaque: true }),
        cookie({ name: 'valid', session: false, expires: 1_900_000_000 }),
      ],
      nowSeconds: 1_800_000_000,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "cookies": [
          {
            "domain": ".example.com",
            "expires": 1900000000,
            "httpOnly": true,
            "name": "valid",
            "partitionKey": undefined,
            "path": "/",
            "priority": "High",
            "sameSite": undefined,
            "secure": true,
            "sourcePort": 443,
            "sourceScheme": "Secure",
            "value": "secret",
          },
        ],
        "skipped": 2,
      }
    `)
  })
})
