// Custom entry: mounts holocron as a child of a Spiceflow app.
// Auth middleware (better-auth) runs first, then auth/dashboard pages,
// then holocron docs. Also serves /.well-known/agent-skills/* so
// `npx skills add https://playwriter.dev` installs the skill from this
// domain instead of the GitHub repo. Cloudflare Workers fetch handler
// is provided by spiceflow/cloudflare-entrypoint.

import './globals.css'

import { Spiceflow, redirect, json } from 'spiceflow'
import { Head, Link, router } from 'spiceflow/react'
import { z } from 'zod'
import { app as holocronApp } from '@holocron.so/vite/app'
import { getAuth, getBaseUrl, getSession, requireSession, ensureOrg, getOrgSubscription, getOrgWithSubscription, listUserApiKeys } from './db.ts'
import { normalizeAuthRedirectPath } from './auth-redirect.ts'
import { cloudApp } from './cloud-api.ts'
import { stripeWebhookApp } from './stripe-webhook.ts'
import { approveDevice, denyDevice, createApiKey, revokeApiKey } from './actions.tsx'
import { enforceProxyBudgets } from './scheduled.ts'
import { routeRemoteControlRequest } from './remote-control-tunnel.ts'
import playwriterSkillMd from '../../skills/playwriter/SKILL.md?raw'

export { RemoteControlTunnel } from './remote-control-tunnel.ts'

const PLAYWRITER_SKILL_DESCRIPTION =
  "Control the user own Chrome browser via Playwriter extension with Playwright code snippets in a stateful local js sandbox. Use this over other Playwright MCPs to automate the browser — it connects to the user's existing Chrome instead of launching a new one. Use this cli for navigating JS-heavy websites (Instagram, Twitter, cookie/login walls, lazy-loaded UIs) instead of webfetch/curl. ALWAYS load this skill before using any playwriter commands"

// skills.sh validates the artifact against this sha256 digest, so it must
// match the exact bytes served at /.well-known/agent-skills/playwriter/SKILL.md.
let skillDigestPromise: Promise<string> | undefined
function getSkillDigest(): Promise<string> {
  skillDigestPromise ??= (async () => {
    const bytes = new TextEncoder().encode(playwriterSkillMd)
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
    return `sha256:${hex}`
  })()
  return skillDigestPromise
}

const loginQuerySchema = z.object({ callbackURL: z.string().optional() })

const devicePageQuerySchema = z.object({
  user_code: z.string().optional(),
  status: z.enum(['approved', 'denied']).optional(),
})

// ── OAuth redirect helper ───────────────────────────────────────────

/** Create a Google OAuth redirect with cookies forwarded for CSRF state.
 *  better-auth's signInSocial returns JSON { url, redirect }, not a 302.
 *  We must build the redirect ourselves and forward Set-Cookie headers. */
async function createGoogleSignInRedirect(request: Pick<Request, 'headers'>, callbackURL: string) {
  const auth = getAuth()
  const { response, headers } = await auth.api.signInSocial({
    body: { provider: 'google', callbackURL },
    headers: request.headers,
    returnHeaders: true,
  })
  if (!response?.url) {
    throw json({ error: 'failed to start google sign-in' }, { status: 500 })
  }

  const redirectResponse = new Response(null, {
    status: 302,
    headers: { Location: response.url },
  })
  for (const cookie of headers.getSetCookie()) {
    redirectResponse.headers.append('Set-Cookie', cookie)
  }
  return redirectResponse
}

// ── Main app ────────────────────────────────────────────────────────

export const app = new Spiceflow()

  .use(({ request }, next) => {
    const url = new URL(request.url)
    if (!url.hostname.startsWith('www.')) return next()
    url.hostname = url.hostname.slice('www.'.length)
    url.protocol = 'https:'
    throw redirect(url.toString(), { status: 301 })
  })

  // Auth middleware: intercept /api/auth/* and forward to better-auth
  .use(async ({ request }, next) => {
    if (request.parsedUrl.pathname.startsWith('/api/auth')) {
      const auth = getAuth()
      const res = await auth.handler(request)
      if (res.ok || res.status !== 404) return res
    }
    return next()
  })

  // ── Login page ────────────────────────────────────────────────────

  .page({
    path: '/login',
    query: loginQuerySchema,
    handler: async ({ request, query }) => {
      const session = await getSession(request)
      if (session) throw redirect('/dashboard')
      const callbackURL = normalizeAuthRedirectPath(query.callbackURL)
      const { SignInButton } = await import('./components/login-button.tsx')
      const { AuthPage } = await import('./components/auth-page.tsx')
      return (
        <AuthPage
          title=""
          description="Sign in to manage your cloud browsers."
          footer={
            <SignInButton href={router.href('/login/google', { callbackURL })}>
              Sign in with Google
            </SignInButton>
          }
        />
      )
    },
  })

  // Google sign-in redirect (creates OAuth redirect with cookies forwarded)
  .route({
    method: 'GET',
    path: '/login/google',
    query: loginQuerySchema,
    async handler({ request, query }) {
      return createGoogleSignInRedirect(request, normalizeAuthRedirectPath(query.callbackURL))
    },
  })

  // ── Dashboard page ────────────────────────────────────────────────

  .page('/dashboard', async ({ request }) => {
    const session = await getSession(request)
    if (!session) throw redirect('/login')

    // Try single-query path first (org already exists). Falls back to
    // ensureOrg + getOrgSubscription on first visit when the org needs creating.
    let orgInfo: { id: string; name: string }
    let subscription: Awaited<ReturnType<typeof getOrgSubscription>>
    const existing = await getOrgWithSubscription(session.userId)
    if (existing) {
      orgInfo = existing.org
      subscription = existing.subscription
    } else {
      orgInfo = await ensureOrg(session.userId, session.user.name)
      subscription = await getOrgSubscription(orgInfo.id)
    }

    const apiKeys = await listUserApiKeys(session.userId)

    const { SignOutButton } = await import('./components/sign-out-button.tsx')
    const { BillingPanel } = await import('./components/billing-panel.tsx')
    const { ApiKeyPanel } = await import('./components/api-key-panel.tsx')
    const { QuickStartPanel } = await import('./components/quick-start-panel.tsx')
    const { CloudSessionsPanel } = await import('./components/cloud-sessions-panel.tsx')

    const { PlaywriterLogo } = await import('./components/auth-page.tsx')

    return (
      <div className="mx-auto max-w-3xl px-6 py-10 min-h-screen flex flex-col">
        <Head>
          <Head.Title>Dashboard</Head.Title>
          <Head.Meta name="robots" content="noindex" />
        </Head>
        <div className="flex items-center justify-between mb-8">
          <PlaywriterLogo imageClassName="h-8" />
          <div className="flex items-center gap-4">
            <a href="https://playwriter.dev" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Docs
            </a>
            <SignOutButton />
          </div>
        </div>
        <div className="mb-6">
          <p className="text-sm text-foreground">
            Signed in as <strong>{session.user.name}</strong> ({session.user.email})
          </p>

        </div>
        <BillingPanel subscription={subscription} />
        {subscription && (
          <div className="mt-6">
            <CloudSessionsPanel totalSlots={subscription.quantity} />
          </div>
        )}
        <div className="mt-6">
          <QuickStartPanel />
        </div>
        <div className="mt-6">
          <ApiKeyPanel apiKeys={apiKeys} createAction={createApiKey} revokeAction={revokeApiKey} />
        </div>
        <footer className="mt-auto pt-6 border-t border-border">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <a href="https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe" className="hover:text-foreground transition-colors">
              Chrome Extension
            </a>
            <a href="https://playwriter.dev" className="hover:text-foreground transition-colors">
              Docs
            </a>
            <a href="https://github.com/remorses/playwriter" className="hover:text-foreground transition-colors">
              GitHub
            </a>
            <a href="https://github.com/remorses/playwriter/releases" className="hover:text-foreground transition-colors">
              Changelog
            </a>
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
            <a href="https://playwriter.dev/#pricing" className="hover:text-foreground transition-colors">
              Pricing
            </a>
          </div>
        </footer>
      </div>
    )
  })

  // ── Device flow verification page ─────────────────────────────────

  .page({
    path: '/device',
    query: devicePageQuerySchema,
    handler: async ({ request, query }) => {
      const userCode = query.user_code ?? ''
      const status = query.status
      const { AuthPage } = await import('./components/auth-page.tsx')

      if (!userCode) {
        return (
          <AuthPage
            title="CLI Login"
            description="Open this page from the CLI login flow with a valid device code."
          />
        )
      }

      if (status === 'approved') {
        return (
          <AuthPage
            title="CLI Approved"
            description="You can close this page and return to the terminal."
          />
        )
      }

      if (status === 'denied') {
        return (
          <AuthPage
            title="CLI Denied"
            description="You can close this page and start the login flow again."
          />
        )
      }

      const session = await getSession(request)
      if (!session) {
        throw redirect(
          router.href('/login', {
            callbackURL: normalizeAuthRedirectPath(`${request.parsedUrl.pathname}${request.parsedUrl.search}`),
          }),
        )
      }

      // deviceVerify validates the code AND claims it for the authenticated session.
      // MUST pass request.headers so better-auth links the device code to this user.
      const auth = getAuth()
      const device = await auth.api.deviceVerify({
        query: { user_code: userCode },
        headers: request.headers,
      }).catch(() => null)

      if (!device) {
        return (
          <AuthPage
            title="Invalid Device Code"
            description="That device code is invalid or expired. Start the CLI login flow again."
          />
        )
      }

      const { DeviceActionButtons } = await import('./components/device-action-buttons.tsx')
      return (
        <AuthPage
          title="CLI Login"
          description="A CLI is requesting access to your account."
          footer={
            <DeviceActionButtons approveAction={approveDevice} denyAction={denyDevice} userCode={userCode} />
          }
        >
          <div className="font-mono text-2xl tracking-widest text-foreground">
            {userCode}
          </div>
        </AuthPage>
      )
    },
  })

  // ── Live browser view (pure client-side CDP screencast) ─────────
  .page('/live', async () => {
    const { default: LivePage } = await import('./pages/live.tsx')
    return (
      <>
        <Head>
          <Head.Title>Live Browser View | Playwriter</Head.Title>
          <Head.Meta name="description" content="Watch and interact with a remote browser session in real time." />
        </Head>
        <LivePage />
      </>
    )
  })

  // ── Remote control viewer for a tab shared from the extension ───
  // The tunnel id travels in the URL hash, so it never reaches this handler.
  .page('/remote-control', async () => {
    const { default: RemoteControlPage } = await import('./pages/remote-control.tsx')
    return (
      <>
        <Head>
          <Head.Title>Remote Control | Playwriter</Head.Title>
          <Head.Meta name="description" content="Watch and control a browser tab shared with you through Playwriter." />
          <Head.Meta name="referrer" content="no-referrer" />
          <Head.Meta name="robots" content="noindex, nofollow" />
        </Head>
        <RemoteControlPage />
      </>
    )
  })

  // Skill discovery for `npx skills add https://playwriter.dev` (skills.sh).
  // The url is relative to this index file per the discovery schema.
  .route({
    method: 'GET',
    path: '/.well-known/agent-skills/index.json',
    detail: { hide: true },
    handler: async () =>
      Response.json({
        $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
        skills: [
          {
            name: 'playwriter',
            type: 'skill-md',
            description: PLAYWRITER_SKILL_DESCRIPTION,
            url: './playwriter/SKILL.md',
            digest: await getSkillDigest(),
          },
        ],
      }),
  })
  .route({
    method: 'GET',
    path: '/.well-known/agent-skills/playwriter/SKILL.md',
    detail: { hide: true },
    handler: () =>
      new Response(playwriterSkillMd, {
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      }),
  })

  // Cloud browser API routes (/api/cloud/*)
  .use(cloudApp)

  // Stripe webhook (/api/stripe/webhook) — must be before holocron and
  // outside auth middleware (Stripe authenticates via signature header)
  .use(stripeWebhookApp)

  // Mount holocron last — it handles all docs pages
  .use(holocronApp)

export type App = typeof app

declare module 'spiceflow/react' {
  interface SpiceflowRegister {
    app: typeof app
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const remoteControlResponse = await routeRemoteControlRequest({ request, env })
    if (remoteControlResponse) {
      return remoteControlResponse
    }
    return app.handle(request)
  },
  async scheduled(_controller: ScheduledController, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(enforceProxyBudgets())
  },
} satisfies ExportedHandler<Env>
