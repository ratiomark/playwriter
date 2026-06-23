// Worker-level database client, auth, and session helpers.
//
// getDb() creates a drizzle-orm/d1 client bound to env.DB.
// getAuth() creates a BetterAuth instance with Google social login + device flow.
//
// Auth is NOT a singleton: Cloudflare Workers need per-request env, so getAuth()
// builds a fresh instance each time. BetterAuth's cookieCache keeps session
// resolution fast (no DB query on most requests).

import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from 'db/schema'
import { betterAuth } from 'better-auth/minimal'
import { deviceAuthorization, bearer } from 'better-auth/plugins'
import { drizzleAdapter } from 'better-auth-drizzle-adapter'
import { json } from 'spiceflow'
import { ulid } from 'ulid'
import { ACTIVE_SUBSCRIPTION_STATUSES, type BillingSubscription } from './lib/billing-rules.ts'

// ── Drizzle client via D1 ───────────────────────────────────────────

export function getDb() {
  return drizzle(env.DB, { schema, relations: schema.relations })
}

// ── BetterAuth ──────────────────────────────────────────────────────

export function getAuth() {
  const db = getDb()
  return betterAuth({
    baseURL: getBaseUrl(),
    secret: env.BETTER_AUTH_SECRET as string,
    database: drizzleAdapter(db, { provider: 'sqlite' }),
    session: {
      expiresIn: 60 * 60 * 24 * 365, // 1 year
      updateAge: 60 * 60 * 24, // refresh expiry every 1 day of activity
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID as string,
        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
        prompt: 'select_account',
      },
    },
    plugins: [
      deviceAuthorization({ verificationUri: '/device', schema: {} }),
      bearer(),
    ],
  })
}

export function getBaseUrl(): string {
  const override = env.BETTER_AUTH_URL
  if (typeof override === 'string' && override) return override
  return 'https://playwriter.dev'
}

// ── Session helpers ─────────────────────────────────────────────────

type Session = {
  userId: string
  user: { id: string; name: string; email: string; image: string | null }
}

type RequestHeaders = Pick<Request, 'headers'>

export async function getSession(request: RequestHeaders): Promise<Session | null> {
  const hasCookie = request.headers.has('cookie')
  const hasAuthorization = request.headers.has('authorization')
  if (!hasCookie && !hasAuthorization) return null

  const auth = getAuth()
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null
  return {
    userId: session.user.id,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    },
  }
}

export async function requireSession(request: RequestHeaders): Promise<Session> {
  const session = await getSession(request)
  if (!session) {
    throw json({ error: 'unauthorized' }, { status: 401 })
  }
  return session
}

// ── Org helpers ─────────────────────────────────────────────────────

/** Require session + ensure org in one call. Used by cloud API routes. */
export async function requireOrgSession(request: RequestHeaders): Promise<{
  session: Session
  org: { id: string; name: string }
}> {
  const session = await requireSession(request)
  const org = await ensureOrg(session.userId, session.user.name)
  return { session, org }
}

// ── Subscription helpers ────────────────────────────────────────────

/** Get the org's active subscription, if any. Returns a lightweight type
 *  suitable for the dashboard billing UI. Must NOT be cached — billing
 *  state must be immediately fresh after a webhook upserts a row. */
export async function getOrgSubscription(orgId: string): Promise<BillingSubscription | null> {
  const db = getDb()
  const sub = await db.query.subscription.findFirst({
    where: {
      orgId,
      status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
    },
  })
  if (!sub) return null
  return {
    status: sub.status,
    quantity: sub.quantity,
    planName: sub.planName,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  }
}

/** Get or create the user's org. Idempotent and race-safe:
 *  if two concurrent requests both try to create, the loser catches
 *  the unique constraint error and re-reads the winner's row. */
export async function ensureOrg(
  userId: string,
  userName: string,
): Promise<{ id: string; name: string }> {
  const db = getDb()
  const existing = await db.query.orgMember.findFirst({
    where: { userId },
    with: { org: true },
  })
  if (existing?.org) return { id: existing.org.id, name: existing.org.name }

  const orgId = ulid()
  try {
    await db.batch([
      db.insert(schema.org).values({ id: orgId, name: userName }),
      db.insert(schema.orgMember).values({ orgId, userId, role: 'admin' }),
    ])
    return { id: orgId, name: userName }
  } catch (err) {
    // Race: another request already created the org for this user.
    const winner = await db.query.orgMember.findFirst({
      where: { userId },
      with: { org: true },
    })
    if (winner?.org) return { id: winner.org.id, name: winner.org.name }
    throw err
  }
}
