// Server actions for the playwriter.dev website.
// Device flow actions and billing (checkout + portal) actions.
'use server'

import { getActionRequest, parseFormData, redirect } from 'spiceflow'
import { router } from 'spiceflow/react'
import { z } from 'zod'
import { getAuth, getBaseUrl, requireSession, requireOrgSession, getOrgSubscription } from './db.ts'
import { getOrCreateStripeCustomer, getCloudPriceId, getStripe } from './lib/stripe.ts'
import type { BillingInterval } from './lib/billing-rules.ts'

// ── Device flow actions (used by /device page) ──────────────────────

const deviceUserCodeSchema = z.object({ userCode: z.string().min(1) })

export async function approveDevice(formData: FormData) {
  const actionRequest = getActionRequest()
  await requireSession(actionRequest)
  const { userCode } = parseFormData(deviceUserCodeSchema, formData)
  const auth = getAuth()
  await auth.api.deviceApprove({ body: { userCode }, headers: actionRequest.headers })
  throw redirect(router.href('/device', { user_code: userCode, status: 'approved' }))
}

export async function denyDevice(formData: FormData) {
  const actionRequest = getActionRequest()
  await requireSession(actionRequest)
  const { userCode } = parseFormData(deviceUserCodeSchema, formData)
  const auth = getAuth()
  await auth.api.deviceDeny({ body: { userCode }, headers: actionRequest.headers })
  throw redirect(router.href('/device', { user_code: userCode, status: 'denied' }))
}

// ── Billing actions (used by /dashboard billing panel) ──────────────

const DEFAULT_QUANTITY = 4

const checkoutSchema = z.object({
  interval: z.enum(['monthly', 'yearly']),
  quantity: z.coerce.number().int().min(1).max(100).optional(),
})

/** Start a Stripe Checkout for a cloud browser subscription. If the org
 *  already has an active subscription, redirect to the billing portal
 *  instead so we never create a duplicate. Subscription metadata carries
 *  orgId so the webhook can mirror state back to the right org. */
export async function startCheckout(formData: FormData) {
  const { interval, quantity } = parseFormData(checkoutSchema, formData)
  const billingInterval: BillingInterval = interval === 'monthly' ? 'monthly' : 'yearly'
  const qty = quantity || DEFAULT_QUANTITY

  const actionRequest = getActionRequest()
  const { session, org } = await requireOrgSession(actionRequest)
  const returnUrl = new URL('/dashboard', getBaseUrl()).toString()

  const customerId = await getOrCreateStripeCustomer({ orgId: org.id, email: session.user.email })
  if (customerId instanceof Error) throw customerId

  const stripe = getStripe()

  // If already subscribed, short-circuit to the portal
  const existing = await getOrgSubscription(org.id)
  if (existing) {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })
    throw redirect(portal.url)
  }

  const priceId = await getCloudPriceId(billingInterval)
  if (priceId instanceof Error) throw priceId

  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: qty, adjustable_quantity: { enabled: true, minimum: 1, maximum: 100 } }],
    success_url: returnUrl,
    cancel_url: returnUrl,
    allow_promotion_codes: true,
    client_reference_id: org.id,
    // Managed Payments: Stripe acts as merchant of record, handling
    // indirect tax compliance (VAT, GST, sales tax) globally.
    managed_payments: { enabled: true },
    // Metadata on BOTH the session and the subscription so webhooks
    // can always resolve orgId regardless of event type.
    metadata: { orgId: org.id },
    subscription_data: { metadata: { orgId: org.id } },
  })
  if (!checkout.url) throw new Error('Checkout session has no URL')
  throw redirect(checkout.url)
}

/** Open the Stripe Billing Portal for managing an existing subscription. */
export async function openBillingPortal() {
  const actionRequest = getActionRequest()
  const { session, org } = await requireOrgSession(actionRequest)
  const returnUrl = new URL('/dashboard', getBaseUrl()).toString()

  const customerId = await getOrCreateStripeCustomer({ orgId: org.id, email: session.user.email })
  if (customerId instanceof Error) throw customerId

  const stripe = getStripe()
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
  throw redirect(portal.url)
}
