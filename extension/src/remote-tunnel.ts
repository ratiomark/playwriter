// Tunnel upstream client running inside the extension service worker.
// Exposes the extension WS protocol at wss://playwriter.dev/tunnel/{tunnelId}/extension
// so a remote playwriter relay, or the playwriter.dev viewer page, can dial the tab
// without any local playwriter install. The id stays in the URL path so DNS and
// TLS SNI never see it.
// See playwriter/src/remote-control.ts for the shared protocol types and guards.

import {
  buildRemoteControlUrl,
  buildRemoteUpstreamWsUrl,
  shouldDropRemoteTunnelFrame,
  type TraforoDownstreamMessage,
  type TraforoUpstreamMessage,
  type TraforoWsOpenMessage,
} from 'playwriter/src/remote-control'

export type TunnelStatus = 'connecting' | 'online' | 'error'

export type TunnelConnectionHandlers = {
  onMessage(data: string): void
  onClose(): void
}

export type RemoteTunnelOptions = {
  tunnelId: string
  /** Host serving the /tunnel/{id} paths, e.g. playwriter.dev */
  baseDomain: string
  logger: { debug(...args: unknown[]): void; error(...args: unknown[]): void }
  /**
   * Called when a remote relay dials /extension through the tunnel.
   * Return handlers for incoming frames, or null to reject the connection.
   */
  onConnectionOpen(connection: {
    id: string
    send(data: string): void
    canSendScreencastFrame(): boolean
    close(): void
  }): TunnelConnectionHandlers | null
  onStatusChange(status: TunnelStatus, detail?: string): void
}

/**
 * Keepalive interval. Under 30s so the MV3 service worker idle timer never
 * fires: relay pings are answered at the edge and never reach us, so this ping
 * (auto-answered by the Durable Object without waking it) is the only keepalive.
 */
const PING_INTERVAL_MS = 20_000
const RECONNECT_DELAY_MS = 3_000
// 4409 = tunnel id already has a connected upstream. After an unclean service
// worker death the DO still sees the dead socket as connected until Cloudflare
// reaps it (~100s without pings). Retry slowly for a few minutes before giving
// up so restored tunnels reclaim their id instead of dying forever.
const CONFLICT_RETRY_DELAY_MS = 15_000
const MAX_CONFLICT_RETRIES = 12

export class RemoteTunnel {
  private options: RemoteTunnelOptions
  private ws: WebSocket | null = null
  private closed = false
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connections = new Map<string, TunnelConnectionHandlers>()
  private conflictRetries = 0

  constructor(options: RemoteTunnelOptions) {
    this.options = options
  }

  /** Link the user shares. Points at the viewer page, not at the tunnel host. */
  get url(): string {
    return buildRemoteControlUrl({ tunnelId: this.options.tunnelId })
  }

  start(): void {
    if (this.closed) {
      return
    }
    this.options.onStatusChange('connecting')
    const wsUrl = buildRemoteUpstreamWsUrl({
      tunnelId: this.options.tunnelId,
      baseDomain: this.options.baseDomain,
    })
    this.options.logger.debug('Remote tunnel connecting')

    let accepted = false
    const socket = new WebSocket(wsUrl)
    this.ws = socket

    socket.onmessage = (event: MessageEvent) => {
      const raw = typeof event.data === 'string' ? event.data : ''
      let msg: TraforoUpstreamMessage
      try {
        msg = JSON.parse(raw) as TraforoUpstreamMessage
      } catch {
        return
      }

      if (msg.type === 'upstream_accepted') {
        accepted = true
        this.conflictRetries = 0
        this.options.logger.debug('Remote tunnel online')
        this.options.onStatusChange('online')
        this.startPing()
        return
      }
      this.handleMessage(msg)
    }

    socket.onclose = (event: CloseEvent) => {
      this.stopPing()
      this.ws = null
      this.closeAllConnections()

      if (this.closed) {
        return
      }

      if (event.code === 4409) {
        this.conflictRetries++
        if (this.conflictRetries > MAX_CONFLICT_RETRIES) {
          this.closed = true
          this.options.logger.error('Remote tunnel id still in use after retries, giving up')
          this.options.onStatusChange('error', 'Tunnel id already in use')
          return
        }
        this.options.logger.debug(
          `Remote tunnel id in use (stale upstream?), retry ${this.conflictRetries}/${MAX_CONFLICT_RETRIES} in ${CONFLICT_RETRY_DELAY_MS}ms`,
        )
        this.options.onStatusChange('connecting', 'Waiting for stale tunnel to expire')
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          this.start()
        }, CONFLICT_RETRY_DELAY_MS)
        return
      }
      this.options.logger.debug(
        `Remote tunnel disconnected (code=${event.code} accepted=${accepted}), reconnecting in ${RECONNECT_DELAY_MS}ms`,
      )
      this.options.onStatusChange('connecting')
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.start()
      }, RECONNECT_DELAY_MS)
    }

    socket.onerror = () => {
      // onclose fires right after and handles reconnection
      this.options.logger.debug('Remote tunnel WebSocket error')
    }
  }

  close(): void {
    this.closed = true
    this.stopPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.closeAllConnections()
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }
  }

  private closeAllConnections(): void {
    for (const handlers of this.connections.values()) {
      try {
        handlers.onClose()
      } catch {}
    }
    this.connections.clear()
  }

  private startPing(): void {
    this.stopPing()
    this.pingInterval = setInterval(() => {
      this.send({ method: 'ping' })
    }, PING_INTERVAL_MS)
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  private send(msg: TraforoDownstreamMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }
    try {
      this.ws.send(JSON.stringify(msg))
    } catch {}
  }

  private handleMessage(msg: TraforoUpstreamMessage): void {
    switch (msg.type) {
      case 'http_request': {
        // Minimal health response so curl/browsers hitting the tunnel see something sane.
        const isRoot = msg.path === '/' || msg.path.startsWith('/?')
        this.send({
          type: 'http_response',
          id: msg.id,
          status: isRoot ? 200 : 404,
          headers: { 'content-type': 'text/plain' },
          body: isRoot ? btoa('playwriter remote control tunnel') : null,
        })
        return
      }
      case 'ws_open': {
        this.handleWsOpen(msg)
        return
      }
      case 'ws_frame': {
        const handlers = this.connections.get(msg.connId)
        if (!handlers) {
          return
        }
        // Extension protocol is JSON text only; ignore binary frames.
        if (msg.binary) {
          return
        }
        handlers.onMessage(msg.data)
        return
      }
      case 'ws_close': {
        const handlers = this.connections.get(msg.connId)
        this.connections.delete(msg.connId)
        if (handlers) {
          try {
            handlers.onClose()
          } catch {}
        }
        return
      }
    }
  }

  private handleWsOpen(msg: TraforoWsOpenMessage): void {
    const path = msg.path.split('?')[0]
    if (path !== '/extension') {
      this.send({ type: 'ws_error', connId: msg.connId, error: `Unknown path: ${path}` })
      return
    }

    const connId = msg.connId
    const handlers = this.options.onConnectionOpen({
      id: connId,
      send: (data) => {
        this.send({ type: 'ws_frame', connId, data, binary: false })
      },
      canSendScreencastFrame: () => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return false
        }
        return !shouldDropRemoteTunnelFrame({
          bufferedAmount: this.ws.bufferedAmount,
          isScreencastFrame: true,
        })
      },
      close: () => {
        this.connections.delete(connId)
        this.send({ type: 'ws_closed', connId, code: 1000, reason: 'closed by extension' })
      },
    })

    if (!handlers) {
      this.send({ type: 'ws_error', connId, error: 'Connection rejected' })
      return
    }

    this.connections.set(connId, handlers)
    this.send({ type: 'ws_opened', connId })
    this.options.logger.debug('Remote relay connected through tunnel:', connId)
  }
}
