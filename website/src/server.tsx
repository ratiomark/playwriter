// Custom entry: mounts holocron as a child of a Spiceflow app.
// Auth middleware (better-auth) runs first, then auth/dashboard pages,
// then holocron docs. Cloudflare Workers fetch handler is provided
// by spiceflow/cloudflare-entrypoint.

import './globals.css'

import { Spiceflow, redirect, json } from 'spiceflow'
import { router } from 'spiceflow/react'
import { z } from 'zod'
import { app as holocronApp } from '@holocron.so/vite/app'
import { getAuth, getBaseUrl, getSession, requireSession, ensureOrg, getOrgSubscription } from './db.ts'
import { normalizeAuthRedirectPath } from './auth-redirect.ts'
import { cloudApp } from './cloud-api.ts'
import { stripeWebhookApp } from './stripe-webhook.ts'
import { approveDevice, denyDevice } from './actions.tsx'

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
      const { AuthPage, PlaywriterLogo } = await import('./components/auth-page.tsx')
      return (
        <AuthPage
          title="Playwriter"
          visualTitle={<PlaywriterLogo imageClassName="h-8" />}
          headTitle="Sign in"
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

    const orgInfo = await ensureOrg(session.userId, session.user.name)
    const subscription = await getOrgSubscription(orgInfo.id)
    const { SignOutButton } = await import('./components/sign-out-button.tsx')
    const { BillingPanel } = await import('./components/billing-panel.tsx')

    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <SignOutButton />
        </div>
        <div className="mb-6">
          <p className="text-sm text-foreground">
            Signed in as <strong>{session.user.name}</strong> ({session.user.email})
          </p>
          <p className="text-sm text-muted-foreground mt-1">Organization: {orgInfo.name}</p>
        </div>
        <BillingPanel subscription={subscription} />
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
  async fetch(request: Request): Promise<Response> {
    return app.handle(request)
  },
} satisfies ExportedHandler
