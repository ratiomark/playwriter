// Remote control viewer: renders a live, clickable view of a browser tab that
// someone shared with the Playwriter extension's "Remote control" button.
//
// The link looks like https://playwriter.dev/remote-control#<tunnelId>. The id is
// a bearer secret, so it starts in the hash and is omitted from the viewer-page
// request and Referer. The client then uses it to connect to the tunnel hostname.
//
// The tunnel speaks the Playwriter extension protocol rather than raw CDP, so the
// viewer uses the 'extension' transport of CdpViewer.

'use client'

import { buildTunnelOrigin } from 'playwriter/src/remote-control'
import { useEffect, useState } from 'react'
import { CdpViewer } from '../components/cdp-screencast.tsx'

function readTunnelIdFromHash(): string | null {
  const id = window.location.hash.slice(1)
  return /^[a-z0-9-]{1,63}$/.test(id) ? id : null
}

export default function RemoteControlPage() {
  const [tunnelId, setTunnelId] = useState<string | null | undefined>(undefined)

  // Read the hash on the client only. The server cannot see it, so rendering from
  // it during SSR would always disagree with the client and break hydration.
  useEffect(() => {
    const apply = () => {
      setTunnelId(readTunnelIdFromHash())
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => {
      window.removeEventListener('hashchange', apply)
    }
  }, [])

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
      htmlGutter: html.style.scrollbarGutter,
    }
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'none'
    body.style.overscrollBehavior = 'none'
    html.style.scrollbarGutter = 'auto'
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
    }
    document.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      html.style.overflow = prev.htmlOverflow
      body.style.overflow = prev.bodyOverflow
      html.style.overscrollBehavior = prev.htmlOverscroll
      body.style.overscrollBehavior = prev.bodyOverscroll
      html.style.scrollbarGutter = prev.htmlGutter
      document.removeEventListener('wheel', onWheel)
    }
  }, [])

  const wsUrl = tunnelId === undefined ? undefined : tunnelId ? `${buildTunnelOrigin({}).replace(/^https/, 'wss')}/tunnel/${tunnelId}/extension` : null

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden overscroll-none bg-neutral-950">
      {wsUrl === undefined ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <svg className="size-6 animate-spin text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
        </div>
      ) : wsUrl ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="h-full min-h-0 w-full max-w-[1400px]">
            <CdpViewer wsUrl={wsUrl} transport="extension" initialControl />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4">
          <h1 className="text-2xl font-semibold text-white">Remote Control</h1>
          <p className="max-w-md text-center text-sm text-white/50">
            This page needs a share link. Ask the person sharing their tab to open the Playwriter toolbar on their tab, click{' '}
            <strong className="text-white/70">Remote control</strong>, and send you the link they get.
          </p>
          <p className="text-xs text-white/30">
            Links look like <code className="rounded bg-white/5 px-1.5 py-0.5">playwriter.dev/remote-control#your-id</code>
          </p>
        </div>
      )}
    </div>
  )
}
