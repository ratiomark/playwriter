// Cloud browser API routes mounted at /api/cloud/*.
// Proxies Browser Use API v3 — the bu_ API key never reaches the client.
// VM status is queried from Browser Use on demand (source of truth),
// our D1 only stores the org → BU session ID mapping for multi-tenancy.
//
// Cost safety: slot is claimed in D1 BEFORE creating the paid VM, so
// concurrent requests can't flood Browser Use with wasted VMs. The slot
// claim and VM creation run in parallel for latency, but if the slot
// claim fails we never start the VM (Promise.all rejects immediately).

import { env } from 'cloudflare:workers'
import { Spiceflow, json } from 'spiceflow'
import { z } from 'zod'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { getDb, requireOrgSession } from './db.ts'
import { BrowserUseClient, BrowserUseApiError } from './lib/browser-use.ts'
import type { BrowserSession } from './lib/browser-use.ts'
import { ACTIVE_SUBSCRIPTION_STATUSES } from './lib/billing-rules.ts'

function getBrowserUse() {
  return new BrowserUseClient({ apiKey: env.BROWSER_USE_API_KEY as string })
}

// ── Constants ───────────────────────────────────────────────────────

/** Minimum milliseconds between cloud session creations per org.
 *  Prevents rapid connect/disconnect loops that waste VM costs
 *  (Browser Use charges minimum 1 minute per VM). */
const MIN_CREATE_INTERVAL_MS = 10_000

/** Maximum session timeout in minutes for normal orgs. Browser Use
 *  allows up to 240 but we cap lower to limit cost exposure. */
const MAX_TIMEOUT_MINUTES = 60

const PENDING_PREFIX = 'pending-'
/** Placeholder rows older than 2 minutes are considered stale (VM creation
 *  should complete in under 60s). Fresh ones are counted as occupied slots. */
const PENDING_STALE_MS = 2 * 60_000

// ── Types ───────────────────────────────────────────────────────────

interface CloudSessionStatus {
  cloudSessionId: string
  browserUseSessionId: string
  /** Subscription slot index (1-based), matches DB slotIndex */
  index: number
  createdAt: number
  status: 'active' | 'stopped'
  cdpUrl: string | null
  /** Our own live viewer URL (/live?wss=<encoded CDP endpoint>) */
  liveUrl: string | null
  timeoutAt: string
}

/** Build our own /live URL from the exact CDP WebSocket URL.
 *  Passes the full wss endpoint so the client connects to the exact host
 *  (Browser Use can shard across cdp1, cdp2, etc.). */
function buildLiveUrl(cdpUrl: string): string {
  const wssUrl = cdpUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
  return `/live?wss=${encodeURIComponent(wssUrl)}`
}

// ── Helpers ─────────────────────────────────────────────────────────

function isUniqueConstraintError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.includes('UNIQUE constraint failed') || message.includes('SQLITE_CONSTRAINT_UNIQUE')
}

function isPendingRow(row: typeof schema.cloudSession.$inferSelect): boolean {
  return row.browserUseSessionId.startsWith(PENDING_PREFIX)
}

/** Claim the first available slot by inserting a placeholder row.
 *  The UNIQUE(orgId, slotIndex) constraint makes this atomic: only one
 *  concurrent request can own each slot. Returns null if all slots taken. */
async function claimSlot({
  orgId,
  maxSessions,
}: {
  orgId: string
  maxSessions: number
}): Promise<typeof schema.cloudSession.$inferSelect | null> {
  const db = getDb()
  const placeholderId = `${PENDING_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  for (let slotIndex = 1; slotIndex <= maxSessions; slotIndex++) {
    try {
      const [row] = await db
        .insert(schema.cloudSession)
        .values({ orgId, slotIndex, browserUseSessionId: placeholderId })
        .returning()
      if (row) return row
    } catch (cause) {
      if (isUniqueConstraintError(cause)) continue
      throw new Error('Failed to claim cloud session slot', { cause })
    }
  }
  return null
}

/** Parse Browser Use cost string (e.g. "0.05") to integer cents. */
function parseCostToCents(cost: string): number {
  const parsed = parseFloat(cost)
  if (Number.isNaN(parsed)) return 0
  return Math.round(parsed * 100)
}

/** Record final cost deltas for a session being removed, then delete the row.
 *  Atomically increments org proxy and browser spend by their respective deltas.
 *  If no BU session data is available (e.g. VM already gone), skips cost updates. */
async function recordFinalCostAndDelete({
  cloudSession,
  buSession,
  orgId,
}: {
  cloudSession: typeof schema.cloudSession.$inferSelect
  buSession: BrowserSession | null
  orgId: string
}): Promise<void> {
  const db = getDb()
  const proxyDelta = buSession
    ? Math.max(0, parseCostToCents(buSession.proxyCost) - cloudSession.lastProxyCostCents)
    : 0
  const browserDelta = buSession
    ? Math.max(0, parseCostToCents(buSession.browserCost) - cloudSession.lastBrowserCostCents)
    : 0

  if (proxyDelta > 0 || browserDelta > 0) {
    // Atomic increment + delete in one batch to avoid partial state
    await db.batch([
      db.update(schema.org)
        .set({
          ...(proxyDelta > 0 ? { proxySpendCents: orm.sql`${schema.org.proxySpendCents} + ${proxyDelta}` } : {}),
          ...(browserDelta > 0 ? { browserSpendCents: orm.sql`${schema.org.browserSpendCents} + ${browserDelta}` } : {}),
          updatedAt: Date.now(),
        })
        .where(orm.eq(schema.org.id, orgId)),
      db.delete(schema.cloudSession)
        .where(orm.eq(schema.cloudSession.id, cloudSession.id)),
    ])
  } else {
    await db.delete(schema.cloudSession)
      .where(orm.eq(schema.cloudSession.id, cloudSession.id))
  }
}

/** Check if a cloud session's BU VM is still alive. Returns null if dead.
 *  On confirmed 404 or 400 (invalid ID): marks as dead for cleanup.
 *  On transient errors (500, network): leaves the row for next cron/status retry. */
async function resolveActiveSession(
  row: typeof schema.cloudSession.$inferSelect,
  bu: BrowserUseClient,
  deadIds: string[],
): Promise<BrowserSession | null> {
  try {
    const vm = await bu.getBrowser(row.browserUseSessionId)
    if (vm.status === 'active') {
      return vm
    }
    // VM is stopped — record final cost and mark as dead
    await recordFinalCostAndDelete({ cloudSession: row, buSession: vm, orgId: row.orgId })
    deadIds.push(row.id)
    return null
  } catch (err) {
    // Treat 404 (VM gone) and 400 (malformed ID, e.g. legacy pending-* rows)
    // as dead. Transient errors (500, rate limit, network) leave the row
    // intact so the next check can retry.
    if (err instanceof BrowserUseApiError && (err.status === 404 || err.status === 400)) {
      deadIds.push(row.id)
    }
    return null
  }
}

/** Check if a cloud session row represents an occupied slot.
 *  Pending rows younger than PENDING_STALE_MS count as occupied.
 *  Stale pending rows are pushed into deadIds for batch cleanup. */
function checkSlotOccupied(
  row: typeof schema.cloudSession.$inferSelect,
  deadIds: string[],
): 'occupied' | 'dead' | 'needs-api-check' {
  if (isPendingRow(row)) {
    if (Date.now() - row.createdAt < PENDING_STALE_MS) {
      return 'occupied'
    }
    deadIds.push(row.id)
    return 'dead'
  }
  return 'needs-api-check'
}

/** Delete dead cloud session rows in one statement. Idempotent: concurrent
 *  requests deleting the same row is safe (DELETE by PK is a no-op if gone). */
async function cleanupDeadSessions(deadIds: string[]): Promise<void> {
  if (deadIds.length === 0) return
  const db = getDb()
  const uniqueIds = [...new Set(deadIds)]
  await db.delete(schema.cloudSession).where(orm.inArray(schema.cloudSession.id, uniqueIds))
}

// ── Sub-app ─────────────────────────────────────────────────────────

export const cloudApp = new Spiceflow({ basePath: '/api/cloud' })

  // ── GET /api/cloud/status ───────────────────────────────────────
  // Returns org's active cloud sessions with their VM status.
  .get('/status', async ({ request }) => {
    const { org } = await requireOrgSession(request)
    const db = getDb()
    const bu = getBrowserUse()

    const sessions = await db.query.cloudSession.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: 'asc' },
    })

    // Check each non-pending session against BU API in parallel, collecting
    // dead IDs for a single batch-delete at the end.
    const deadIds: string[] = []
    const nonPending = sessions.filter((row) => {
      if (isPendingRow(row)) {
        if (Date.now() - row.createdAt >= PENDING_STALE_MS) {
          deadIds.push(row.id)
        }
        return false
      }
      return true
    })
    const vmResults = await Promise.all(
      nonPending.map((row) => {
        return resolveActiveSession(row, bu, deadIds)
      }),
    )

    const result: CloudSessionStatus[] = []
    for (let i = 0; i < nonPending.length; i++) {
      const row = nonPending[i]!
      const vm = vmResults[i]
      if (vm) {
        result.push({
          cloudSessionId: row.id,
          browserUseSessionId: row.browserUseSessionId,
          index: row.slotIndex,
          createdAt: row.createdAt,
          status: vm.status,
          cdpUrl: vm.cdpUrl,
          liveUrl: vm.cdpUrl ? buildLiveUrl(vm.cdpUrl) : null,
          timeoutAt: vm.timeoutAt,
        })
      }
    }

    // Batch-delete all dead/stale sessions in one D1 call
    await cleanupDeadSessions(deadIds)

    return { sessions: result }
  })

  // ── POST /api/cloud/connect ─────────────────────────────────────
  // Create a new Browser Use VM for the org.
  // Returns the cdpUrl for direct CDP connection.
  .route({
    method: 'POST',
    path: '/connect',
    request: z.object({
      proxyRegion: z.string().optional(),
      /** Cloud browser timeout in minutes (1-60, default 30) */
      timeout: z.number().min(1).max(MAX_TIMEOUT_MINUTES).optional(),
    }),
    async handler({ request }) {
      const { org } = await requireOrgSession(request)
      const body = await request.json()
      const db = getDb()
      const bu = getBrowserUse()

      // Batch-read subscription + cloud sessions + org budget in one D1 round-trip.
      const [activeSub, dbSessions, orgRow] = await db.batch([
        db.query.subscription.findFirst({
          where: {
            orgId: org.id,
            status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
          },
        }),
        db.query.cloudSession.findMany({
          where: { orgId: org.id },
        }),
        db.query.org.findFirst({
          where: { id: org.id },
          columns: {
            proxySpendCents: true,
            proxyBudgetCents: true,
            browserSpendCents: true,
            browserBudgetCents: true,
            spendPeriodStart: true,
            lastCloudCreateAt: true,
          },
        }),
      ] as const)
      if (!activeSub) {
        throw json(
          { error: 'No active subscription. Run `playwriter cloud subscribe` to get started.' },
          { status: 403 },
        )
      }

      // Per-org creation rate limit: prevent rapid connect/disconnect loops.
      // Browser Use charges minimum 1 minute per VM, so a tight loop wastes money.
      if (orgRow?.lastCloudCreateAt && Date.now() - orgRow.lastCloudCreateAt < MIN_CREATE_INTERVAL_MS) {
        const waitSec = Math.ceil((MIN_CREATE_INTERVAL_MS - (Date.now() - orgRow.lastCloudCreateAt)) / 1000)
        throw json(
          { error: `Too many cloud session requests. Please wait ${waitSec}s before creating another session.` },
          { status: 429 },
        )
      }

      // Detect billing period rollover and reset spend if needed.
      // This also handles the case where all sessions were killed by the cron
      // (no active sessions = cron returns early = period never resets).
      // Without this, the org would be permanently blocked after a period ends.
      const periodRolledOver = activeSub.currentPeriodStart != null
        && orgRow?.spendPeriodStart !== activeSub.currentPeriodStart
      let proxySpendCents = orgRow?.proxySpendCents ?? 0
      let browserSpendCents = orgRow?.browserSpendCents ?? 0
      if (periodRolledOver) {
        proxySpendCents = 0
        browserSpendCents = 0
        await db.update(schema.org)
          .set({
            proxySpendCents: 0,
            browserSpendCents: 0,
            spendPeriodStart: activeSub.currentPeriodStart,
            updatedAt: Date.now(),
          })
          .where(orm.eq(schema.org.id, org.id))
      }

      // Block new sessions if org exceeded either budget
      if (orgRow && proxySpendCents >= orgRow.proxyBudgetCents) {
        const spentDollars = (proxySpendCents / 100).toFixed(2)
        const budgetDollars = (orgRow.proxyBudgetCents / 100).toFixed(2)
        throw json(
          { error: `Proxy usage budget exceeded ($${spentDollars}/$${budgetDollars}). Contact support to increase your budget.` },
          { status: 403 },
        )
      }
      if (orgRow && browserSpendCents >= orgRow.browserBudgetCents) {
        const spentDollars = (browserSpendCents / 100).toFixed(2)
        const budgetDollars = (orgRow.browserBudgetCents / 100).toFixed(2)
        throw json(
          { error: `Browser VM budget exceeded ($${spentDollars}/$${budgetDollars}). Contact support to increase your budget.` },
          { status: 403 },
        )
      }

      const maxSessions = activeSub.quantity
      // Check each session, collecting dead IDs for batch cleanup.
      // BU API checks run in parallel; stale pending rows are detected locally.
      const deadIds: string[] = []
      let freshPendingCount = 0
      const buCheckRows: typeof dbSessions = []
      for (const row of dbSessions) {
        const status = checkSlotOccupied(row, deadIds)
        if (status === 'occupied') {
          freshPendingCount++
        } else if (status === 'needs-api-check') {
          buCheckRows.push(row)
        }
      }
      const buResults = await Promise.all(
        buCheckRows.map((row) => {
          return resolveActiveSession(row, bu, deadIds)
        }),
      )
      await cleanupDeadSessions(deadIds)
      const buOccupied = buResults.filter(Boolean).length
      const activeCount = freshPendingCount + buOccupied

      if (activeCount >= maxSessions) {
        throw json(
          {
            error: `Cloud session limit reached (${activeCount}/${maxSessions}). Stop an existing session or upgrade your subscription quantity.`,
          },
          { status: 403 },
        )
      }

      // Claim a slot BEFORE creating the paid VM to prevent concurrent
      // requests from flooding Browser Use with wasted VMs.
      const cloudSession = await claimSlot({ orgId: org.id, maxSessions })
      if (!cloudSession) {
        throw json(
          { error: `Cloud session limit reached. Stop an existing session or upgrade your subscription quantity.` },
          { status: 403 },
        )
      }

      let vm: BrowserSession
      try {
        vm = await bu.createBrowser({
          proxyCountryCode: body.proxyRegion ?? null,
          timeout: body.timeout ?? 30,
        })
      } catch (cause) {
        await db.delete(schema.cloudSession)
          .where(orm.eq(schema.cloudSession.id, cloudSession.id))
          .catch(() => {})
        throw new Error('Failed to create cloud browser', { cause })
      }

      if (!vm.cdpUrl) {
        await bu.stopBrowser(vm.id).catch(() => {})
        await db.delete(schema.cloudSession)
          .where(orm.eq(schema.cloudSession.id, cloudSession.id))
          .catch(() => {})
        throw json(
          { error: 'Browser Use returned no CDP URL. The VM may have failed to start.' },
          { status: 502 },
        )
      }

      // Update placeholder with real BU session ID and record creation
      // timestamp for rate limiting in one batch (no extra D1 round trip).
      const [updateResult] = await db.batch([
        db.update(schema.cloudSession)
          .set({ browserUseSessionId: vm.id })
          .where(orm.eq(schema.cloudSession.id, cloudSession.id))
          .returning(),
        db.update(schema.org)
          .set({ lastCloudCreateAt: Date.now(), updatedAt: Date.now() })
          .where(orm.eq(schema.org.id, org.id)),
      ])

      if (!updateResult.length) {
        // Placeholder was deleted by concurrent stale cleanup; stop the VM.
        await bu.stopBrowser(vm.id).catch(() => {})
        throw new Error('Cloud session slot was reclaimed during VM creation')
      }

      return {
        cloudSessionId: cloudSession.id,
        cdpUrl: vm.cdpUrl,
        liveUrl: vm.cdpUrl ? buildLiveUrl(vm.cdpUrl) : null,
        timeoutAt: vm.timeoutAt,
      }
    },
  })

  // ── POST /api/cloud/disconnect ──────────────────────────────────
  // Stop a cloud browser VM.
  .route({
    method: 'POST',
    path: '/disconnect',
    request: z.object({
      cloudSessionId: z.string(),
    }),
    async handler({ request }) {
      const { org } = await requireOrgSession(request)
      const body = await request.json()
      const db = getDb()
      const bu = getBrowserUse()

      // Find the session and verify org ownership directly
      const cloudSession = await db.query.cloudSession.findFirst({
        where: { id: body.cloudSessionId, orgId: org.id },
      })
      if (!cloudSession) {
        throw json({ error: 'cloud session not found' }, { status: 404 })
      }

      // Stop the BU VM and capture final cost before deleting the row.
      // stopBrowser returns the final session state including costs.
      let buSession: BrowserSession | null = null
      try {
        buSession = await bu.stopBrowser(cloudSession.browserUseSessionId)
      } catch {
        // VM might already be stopped; try to get final state
        try {
          buSession = await bu.getBrowser(cloudSession.browserUseSessionId)
        } catch {
          // VM is gone, no cost data available
        }
      }

      // Record final cost delta and delete the session row
      await recordFinalCostAndDelete({ cloudSession, buSession, orgId: org.id })

      return { ok: true }
    },
  })
