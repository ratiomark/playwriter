// Browser live view page: renders a CDP screencast of a remote cloud browser session.
// Accepts ?id=<session-uuid> and constructs the wss:// URL client-side.
// Also accepts a full ?wss=<url> for direct WebSocket connections.
//
// Search params are read in useEffect (not during initial render) to avoid
// hydration mismatch: the server has no access to window.location.search,
// so server-rendered HTML would always show the "no params" landing state
// while the client with ?id= would render CdpViewer immediately.

'use client'

import { useEffect, useState } from 'react'
import { CdpViewer } from '../components/cdp-screencast.tsx'

/** Browser Use CDP URL pattern: wss://<session-id>.cdp.browser-use.com */
function buildBrowserUseWsUrl(sessionId: string): string {
  return `wss://${sessionId}.cdp.browser-use.com`
}

export default function LivePage() {
  const [wsUrl, setWsUrl] = useState<string | null | undefined>(undefined)
  const [inputValue, setInputValue] = useState('')

  // Read search params client-side only to avoid hydration mismatch
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const directWsUrl = params.get('wss')
    const sessionId = params.get('id')
    setWsUrl(directWsUrl || (sessionId ? buildBrowserUseWsUrl(sessionId) : null))
  }, [])

  const handleConnect = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) {
      setWsUrl(trimmed)
    } else {
      setWsUrl(buildBrowserUseWsUrl(trimmed))
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950">
      {wsUrl === undefined ? (
        // Brief loading state while reading search params (prevents hydration mismatch)
        <div className="flex flex-1 items-center justify-center">
          <svg className="size-6 animate-spin text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
        </div>
      ) : wsUrl ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="h-full w-full max-w-[1400px]">
            <CdpViewer wsUrl={wsUrl} />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4">
          <div className="flex flex-col items-center gap-3">
            <h1 className="text-2xl font-semibold text-white">Live Browser View</h1>
            <p className="max-w-md text-center text-sm text-white/50">
              Enter a cloud browser session ID or a full WebSocket URL to connect and watch the browser in real time.
            </p>
          </div>

          <form
            className="flex w-full max-w-lg gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              handleConnect()
            }}
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value)
              }}
              placeholder="Session ID or wss:// URL"
              autoFocus
              className="h-10 flex-1 rounded-lg border border-white/15 bg-neutral-900 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30"
            />
            <button type="submit" disabled={!inputValue.trim()} className="h-10 rounded-lg bg-white px-5 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40">
              Connect
            </button>
          </form>

          <div className="text-xs text-white/30">
            Example: <code className="rounded bg-white/5 px-1.5 py-0.5">playwriter.dev/live?id=886e5687-8ee0-48fc-894e-925b32bca8ea</code>
          </div>
        </div>
      )}
    </div>
  )
}
