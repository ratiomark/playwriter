// Pure billing decision functions — no I/O, no Stripe, no DB.
// Subscription quantity determines max concurrent cloud browser sessions.

export const CLOUD_PRICE_LOOKUP_KEYS = {
  monthly: 'cloud_browser_monthly',
  yearly: 'cloud_browser_yearly',
} as const

export type BillingInterval = keyof typeof CLOUD_PRICE_LOOKUP_KEYS

/** Stripe statuses that count as "the org has an active subscription".
 *  past_due is included so a failed renewal doesn't instantly lock a
 *  customer out while Stripe retries the charge. */
export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const

/** Lightweight subscription info for the dashboard UI. */
export type BillingSubscription = {
  status: string
  quantity: number
  planName: string | null
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
}
