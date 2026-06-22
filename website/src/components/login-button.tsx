// Sign-in button that redirects to the Google OAuth flow.
// Uses a full-page redirect to /login/google which creates the OAuth redirect
// with proper cookie forwarding for CSRF state.
'use client'

import { useState } from 'react'
import { Button } from './ui/button.tsx'

export function SignInButton({ href, children }: { href: string; children: React.ReactNode }) {
  const [loading, setLoading] = useState(false)

  return (
    <Button
      className="w-full"
      size="lg"
      loading={loading}
      loadingText="Redirecting..."
      onClick={() => {
        setLoading(true)
        window.location.href = href
      }}
    >
      {children}
    </Button>
  )
}
