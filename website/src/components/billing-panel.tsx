// Billing panel for the dashboard. Shows active subscription info with
// "Manage subscription" button, or pricing + checkout buttons when free.
'use client'

import { Button } from './ui/button.tsx'
import { startCheckout, openBillingPortal } from '../actions.tsx'
import type { BillingSubscription } from '../lib/billing-rules.ts'

function FeatureList() {
  return (
    <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
      <li className="flex items-center gap-2">
        <span className="text-primary">✓</span> Stealth Chromium with anti-bot bypass
      </li>
      <li className="flex items-center gap-2">
        <span className="text-primary">✓</span> Residential proxies in 195+ countries
      </li>
      <li className="flex items-center gap-2">
        <span className="text-primary">✓</span> Live browser preview URL
      </li>
      <li className="flex items-center gap-2">
        <span className="text-primary">✓</span> Auto-stop after 10 min idle
      </li>
    </ul>
  )
}

export function BillingPanel({ subscription }: { subscription: BillingSubscription | null }) {
  if (subscription) {
    const renews = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
      : null
    return (
      <div className="flex max-w-xl flex-col gap-5 rounded-xl border border-border bg-background p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Cloud Browsers</h2>
            <div className="text-sm text-muted-foreground">
              {subscription.quantity} concurrent session{subscription.quantity > 1 ? 's' : ''}
              {' · '}
              <span className="capitalize">{subscription.status}</span>
            </div>
          </div>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            Active
          </span>
        </div>
        <FeatureList />
        {renews && (
          <div className="text-xs text-muted-foreground">
            {subscription.cancelAtPeriodEnd
              ? `Cancels on ${renews}.`
              : `Renews on ${renews}.`}
          </div>
        )}
        <form action={openBillingPortal}>
          <Button type="submit" variant="outline" loadingText="Opening...">
            Manage subscription
          </Button>
        </form>
      </div>
    )
  }

  return (
    <div className="flex max-w-xl flex-col gap-5 rounded-xl border border-border bg-background p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Cloud Browsers</h2>
        <p className="text-sm text-muted-foreground">
          Run stealth Chromium browsers in the cloud with residential proxies and anti-bot bypass.
        </p>
      </div>
      <FeatureList />
      <div className="flex flex-col gap-2 sm:flex-row">
        <form action={startCheckout} className="flex-1">
          <input type="hidden" name="interval" value="monthly" />
          <input type="hidden" name="quantity" value="4" />
          <Button type="submit" className="w-full" loadingText="Redirecting...">
            Subscribe monthly
          </Button>
        </form>
        <form action={startCheckout} className="flex-1">
          <input type="hidden" name="interval" value="yearly" />
          <input type="hidden" name="quantity" value="4" />
          <Button type="submit" variant="outline" className="w-full" loadingText="Redirecting...">
            Subscribe yearly
          </Button>
        </form>
      </div>
    </div>
  )
}
