// Stripe webhook route. Mounted on the root app in server.tsx.
//
// Stripe sends raw POST bodies with a signature header, so the handler reads
// request.text() (NEVER request.json() and NEVER a zod body schema — either
// would consume/normalize the stream and break HMAC verification) and verifies
// it with constructEventAsync (the async variant works in Workers where the
// sync crypto path is unavailable).

import { env } from 'cloudflare:workers'
import { Spiceflow } from 'spiceflow'
import Stripe from 'stripe'
import { getStripe, handleSubscriptionChange } from './lib/stripe.ts'

export const stripeWebhookApp = new Spiceflow({ basePath: '/api/stripe' })

  .post('/webhook', async ({ request }) => {
    const sig = request.headers.get('stripe-signature')
    if (!sig) return new Response('No signature', { status: 400 })

    const rawBody = await request.text()
    const stripe = getStripe()

    // Workers runtime lacks Node.js crypto — must use async Web Crypto API
    // via Stripe's SubtleCryptoProvider for HMAC signature verification.
    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        sig,
        env.STRIPE_WEBHOOK_SECRET as string,
        undefined,
        Stripe.createSubtleCryptoProvider(),
      )
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err)
      return new Response('Bad signature', { status: 400 })
    }

    const result = await (async () => {
      if (
        event.type === 'customer.subscription.created' ||
        event.type === 'customer.subscription.updated' ||
        event.type === 'customer.subscription.deleted'
      ) {
        return handleSubscriptionChange(event.data.object as Stripe.Subscription)
      }
      return null
    })()

    if (result instanceof Error) {
      console.error(`Stripe webhook ${event.type} failed:`, result)
      return new Response('Webhook failed', { status: 500 })
    }

    return new Response('ok', { status: 200 })
  })
