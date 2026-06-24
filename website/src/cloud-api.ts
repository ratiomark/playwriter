// Cloud browser API routes mounted at /api/cloud/*.
// Proxies Browser Use API v3 — the bu_ API key never reaches the client.
// VM status is queried from Browser Use on demand (source of truth),
// our D1 only stores the org → BU session ID mapping for multi-tenancy.

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

// ── Types ───────────────────────────────────────────────────────────

interface CloudSessionStatus {
  cloudSessionId: string
  browserUseSessionId: string
  /** Display index derived from creation order (1-based) */
  index: number
  createdAt: number
  status: 'active' | 'stopped'
  cdpUrl: string | null
  liveUrl: string | null
  timeoutAt: string
}

// ── Helpers ─────────────────────────────────────────────────────────

function isUniqueConstraintError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.includes('UNIQUE constraint failed') || message.includes('SQLITE_CONSTRAINT_UNIQUE')
}

/** Try to insert a cloud session row, claiming the first available slot.
 *  The UNIQUE(orgId, slotIndex) constraint makes this atomic: only one
 *  concurrent request can own each slot. Returns null if all slots are taken. */
async function insertCloudSession({
  orgId,
  maxSessions,
  browserUseSessionId,
}: {
  orgId: string
  maxSessions: number
  browserUseSessionId: string
}): Promise<typeof schema.cloudSession.$inferSelect | null> {
  const db = getDb()
  for (let slotIndex = 1; slotIndex <= maxSessions; slotIndex++) {
    try {
      const [row] = await db
        .insert(schema.cloudSession)
        .values({ orgId, slotIndex, browserUseSessionId })
        .returning()
      if (row) return row
    } catch (cause) {
      if (isUniqueConstraintError(cause)) continue
      throw new Error('Failed to insert cloud session', { cause })
    }
  }
  return null
}

/** Parse Browser Use proxyCost string (e.g. "0.05") to integer cents. */
function parseCostToCents(proxyCost: string): number {
  const parsed = parseFloat(proxyCost)
  if (Number.isNaN(parsed)) return 0
  return Math.round(parsed * 100)
}

/** Record final proxy cost delta for a session being removed, then delete the row.
 *  Atomically increments org.proxySpendCents by the delta between the session's
 *  lastProxyCostCents baseline and the final BU proxyCost. If no BU session data
 *  is available (e.g. VM already gone), skips the cost update. */
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
  const finalCostCents = buSession ? parseCostToCents(buSession.proxyCost) : 0
  const deltaCents = Math.max(0, finalCostCents - cloudSession.lastProxyCostCents)

  if (deltaCents > 0) {
    // Atomic increment + delete in one batch to avoid partial state
    await db.batch([
      db.update(schema.org)
        .set({
          proxySpendCents: orm.sql`${schema.org.proxySpendCents} + ${deltaCents}`,
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

    // Check each session against BU API in parallel, collecting dead IDs
    // for a single batch-delete at the end instead of N individual deletes.
    const deadIds: string[] = []
    const vmResults = await Promise.all(
      sessions.map((row) => {
        return resolveActiveSession(row, bu, deadIds)
      }),
    )

    const result: CloudSessionStatus[] = []
    for (let i = 0; i < sessions.length; i++) {
      const row = sessions[i]!
      const vm = vmResults[i]
      if (vm) {
        result.push({
          cloudSessionId: row.id,
          browserUseSessionId: row.browserUseSessionId,
          index: result.length + 1,
          createdAt: row.createdAt,
          status: vm.status,
          cdpUrl: vm.cdpUrl,
          liveUrl: vm.liveUrl,
          timeoutAt: vm.timeoutAt,
        })
      }
    }

    // Batch-delete all dead sessions in one D1 call
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
      /** Cloud browser timeout in minutes (1-240, default 60) */
      timeout: z.number().min(1).max(240).optional(),
      customProxy: z
        .object({
          host: z.string(),
          port: z.number(),
          username: z.string().optional(),
          password: z.string().optional(),
        })
        .optional(),
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
          columns: { proxySpendCents: true, proxyBudgetCents: true, proxySpendPeriodStart: true },
        }),
      ] as const)
      if (!activeSub) {
        throw json(
          { error: 'No active subscription. Run `playwriter cloud subscribe` to get started.' },
          { status: 403 },
        )
      }

      // Detect billing period rollover and reset spend if needed.
      // This also handles the case where all sessions were killed by the cron
      // (no active sessions = cron returns early = period never resets).
      // Without this, the org would be permanently blocked after a period ends.
      const periodRolledOver = activeSub.currentPeriodStart != null
        && orgRow?.proxySpendPeriodStart !== activeSub.currentPeriodStart
      let proxySpendCents = orgRow?.proxySpendCents ?? 0
      if (periodRolledOver) {
        proxySpendCents = 0
        await db.update(schema.org)
          .set({
            proxySpendCents: 0,
            proxySpendPeriodStart: activeSub.currentPeriodStart,
            updatedAt: Date.now(),
          })
          .where(orm.eq(schema.org.id, org.id))
      }

      // Block new sessions if org exceeded their proxy spend budget
      if (orgRow && proxySpendCents >= orgRow.proxyBudgetCents) {
        const spentDollars = (proxySpendCents / 100).toFixed(2)
        const budgetDollars = (orgRow.proxyBudgetCents / 100).toFixed(2)
        throw json(
          { error: `Proxy usage budget exceeded ($${spentDollars}/$${budgetDollars}). Contact support to increase your budget.` },
          { status: 403 },
        )
      }

      const maxSessions = activeSub.quantity

      // Check each existing session against BU API in parallel, collecting
      // dead IDs for batch cleanup so we get an accurate active count.
      const deadIds: string[] = []
      const buResults = await Promise.all(
        dbSessions.map((row) => {
          return resolveActiveSession(row, bu, deadIds)
        }),
      )
      await cleanupDeadSessions(deadIds)
      const activeCount = buResults.filter(Boolean).length

      if (activeCount >= maxSessions) {
        throw json(
          {
            error: `Cloud session limit reached (${activeCount}/${maxSessions}). Stop an existing session or upgrade your subscription quantity.`,
          },
          { status: 403 },
        )
      }

      // Create the BU VM first, then claim a DB slot. If the slot insert
      // fails (concurrent request took the last slot) or any other error
      // occurs after VM creation, stop the VM so it doesn't leak.
      // This trades a rare wasted VM creation for simpler code (one D1
      // write instead of two) and no placeholder/pending concept.
      const vm = await bu.createBrowser({
        // Proxy disabled by default to save cost. Pass --proxy <region> to enable.
        proxyCountryCode: body.proxyRegion ?? null,
        timeout: body.timeout ?? 60,
        customProxy: body.customProxy,
      })

      try {
        if (!vm.cdpUrl) {
          throw json(
            { error: 'Browser Use returned no CDP URL. The VM may have failed to start.' },
            { status: 502 },
          )
        }

        // Claim a slot via UNIQUE(orgId, slotIndex). If all slots are taken
        // (another request won the race), stop the VM and return 403.
        const cloudSession = await insertCloudSession({
          orgId: org.id,
          maxSessions,
          browserUseSessionId: vm.id,
        })
        if (!cloudSession) {
          throw json(
            { error: `Cloud session limit reached. Stop an existing session or upgrade your subscription quantity.` },
            { status: 403 },
          )
        }

        return {
          cloudSessionId: cloudSession.id,
          cdpUrl: vm.cdpUrl,
          liveUrl: vm.liveUrl,
          timeoutAt: vm.timeoutAt,
        }
      } catch (err) {
        // Stop the VM if anything after creation fails (DB error, no CDP
        // URL, all slots taken) so we don't leak paid Browser Use VMs.
        await bu.stopBrowser(vm.id).catch(() => {})
        throw err
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
      // stopBrowser returns the final session state including proxyCost.
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

      // Record final proxy cost delta and delete the session row
      await recordFinalCostAndDelete({ cloudSession, buSession, orgId: org.id })

      return { ok: true }
    },
  })
