// Owns Playwriter remote-control WebSockets inside one Durable Object per share id.

import { DurableObject } from 'cloudflare:workers'
import type {
  TraforoDownstreamMessage,
  TraforoUpstreamMessage,
} from 'playwriter/src/remote-control'

type SocketAttachment =
  | { role: 'upstream'; connectedAt: number }
  | { role: 'downstream'; connectionId: string }

const CLOSE_INTERNAL_ERROR = 1011
const CLOSE_SERVICE_RESTART = 1012
const CLOSE_TUNNEL_OFFLINE = 4008
const CLOSE_FAILED_TO_CONTACT = 4009
const CLOSE_LOCAL_TIMEOUT = 4010
const CLOSE_LOCAL_WS_ERROR = 4012
const CLOSE_TUNNEL_ID_IN_USE = 4409
const DOWNSTREAM_OPEN_TIMEOUT_MS = 10_000
const RATE_LIMIT_PERIOD_SECONDS = 60

export async function routeRemoteControlRequest({
  request,
  env,
}: {
  request: Request
  env: Env
}): Promise<Response | null> {
  const url = new URL(request.url)
  // Preferred form: tunnel id in the path, so it never appears in DNS or TLS SNI.
  // Anything that is not exactly /tunnel/{id}/upstream or /tunnel/{id}/extension
  // must not be treated as a tunnel.
  const pathMatch = url.pathname.match(/^\/tunnel\/([a-z0-9-]{1,63})\/(upstream|extension)$/)
  // Legacy form: {tunnelId}-tunnel.playwriter.dev subdomain. Kept so older
  // extension versions keep reconnecting after deploy.
  const tunnelId = pathMatch?.[1] || extractTunnelId(url.hostname)
  if (!tunnelId) {
    return null
  }
  const isPathForm = pathMatch !== null
  const isUpstream = pathMatch?.[2] === 'upstream' || (!isPathForm && url.pathname === '/traforo-upstream')

  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Playwriter remote control tunnel', { status: 200 })
  }
  // /tunnel/* is reserved for tunnels; non-WS traffic there never reaches the site app.
  if (!isPathForm && !isUpstream && url.pathname.replace(/\/$/, '') !== '/extension') {
    return new Response('Not Found', { status: 404 })
  }

  const rateLimit = await env.REMOTE_CONTROL_RATE_LIMITER.limit({
    key: request.headers.get('CF-Connecting-IP')?.trim() || 'unknown-client',
  })
  if (!rateLimit.success) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': String(RATE_LIMIT_PERIOD_SECONDS) },
    })
  }

  const id = env.REMOTE_CONTROL_TUNNEL.idFromName(tunnelId)
  if (isPathForm) {
    // Normalize to the DO's internal paths so the DO stays form-agnostic.
    const rewritten = new URL(request.url)
    rewritten.pathname = isUpstream ? '/traforo-upstream' : '/extension'
    return env.REMOTE_CONTROL_TUNNEL.get(id).fetch(new Request(rewritten, request))
  }
  return env.REMOTE_CONTROL_TUNNEL.get(id).fetch(request)
}

function extractTunnelId(hostname: string): string | null {
  const match = hostname.match(/^([a-z0-9-]{1,63})-tunnel(?:-preview)?\.playwriter\.dev$/)
  return match?.[1] || null
}

export class RemoteControlTunnel extends DurableObject<Env> {
  private pendingDownstreams = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Keepalives must never reach webSocketMessage: one message every <10s keeps
    // the DO awake 24/7 (billed duration). New relays send protocol ping frames,
    // which Cloudflare answers without waking the DO. Older relays send this JSON
    // ping every 5s, and new extensions send the same string (browsers cannot
    // send protocol pings), so one pair answers both. Relays ignore the pong.
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"method":"ping"}', '{"method":"pong"}'),
    )
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Playwriter remote control tunnel', { status: 200 })
    }

    const path = new URL(request.url).pathname
    // Keep this legacy path so deployed extension versions reconnect after cutover.
    if (path === '/traforo-upstream' || path === '/upstream') {
      return this.openUpstream()
    }
    if (path.replace(/\/$/, '') === '/extension') {
      // No upstream closes 4008 at once. Never wait for one: relays redial
      // offline ids in a loop, and a held request keeps the DO awake (billed).
      return this.openDownstream(request.headers)
    }
    return new Response('Not Found', { status: 404 })
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment | undefined
    if (!attachment) {
      return
    }

    if (attachment.role === 'upstream') {
      if (typeof message === 'string') {
        this.handleUpstreamMessage(message)
      }
      return
    }

    const upstream = this.getUpstream()
    if (!upstream) {
      closeSocket({ socket, code: CLOSE_SERVICE_RESTART, reason: 'Upstream disconnected' })
      return
    }
    if (typeof message !== 'string') {
      // The Playwriter extension protocol is JSON text only.
      return
    }
    const frame: TraforoUpstreamMessage = {
      type: 'ws_frame',
      connId: attachment.connectionId,
      data: message,
      binary: false,
    }
    this.sendToUpstream(upstream, frame)
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment | undefined
    if (!attachment) {
      return
    }

    if (attachment.role === 'upstream') {
      const activeUpstream = this.getUpstream()
      if (activeUpstream && activeUpstream !== socket) {
        return
      }
      this.disconnectDownstreams()
      return
    }

    this.clearDownstreamTimeout(attachment.connectionId)
    const upstream = this.getUpstream()
    if (!upstream) {
      return
    }
    this.sendToUpstream(upstream, {
      type: 'ws_close',
      connId: attachment.connectionId,
      code,
      reason,
    })
  }

  webSocketError(socket: WebSocket): void {
    closeSocket({ socket, code: CLOSE_INTERNAL_ERROR, reason: 'WebSocket error' })
  }

  private openUpstream(): Response {
    if (this.getUpstream()) {
      return createClosingWebSocketResponse({
        code: CLOSE_TUNNEL_ID_IN_USE,
        reason: 'Remote control id is already in use',
      })
    }

    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server, ['upstream'])
    server.serializeAttachment({
      role: 'upstream',
      connectedAt: Date.now(),
    } satisfies SocketAttachment)
    server.send(JSON.stringify({ type: 'upstream_accepted' }))
    return new Response(null, { status: 101, webSocket: client })
  }

  private openDownstream(headers: Headers): Response {
    const responseHeaders = new Headers()
    const protocol = headers.get('sec-websocket-protocol')
    if (protocol) {
      responseHeaders.set('Sec-WebSocket-Protocol', protocol)
    }

    const upstream = this.getUpstream()
    if (!upstream) {
      return createClosingWebSocketResponse({
        code: CLOSE_TUNNEL_OFFLINE,
        reason: 'Remote control offline',
        headers: responseHeaders,
      })
    }

    const [client, server] = Object.values(new WebSocketPair())
    const connectionId = crypto.randomUUID()
    this.ctx.acceptWebSocket(server, ['downstream', `connection:${connectionId}`])
    server.serializeAttachment({
      role: 'downstream',
      connectionId,
    } satisfies SocketAttachment)

    const requestHeaders: Record<string, string> = {}
    headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'upgrade') {
        requestHeaders[key] = value
      }
    })
    if (!this.sendToUpstream(upstream, {
      type: 'ws_open',
      connId: connectionId,
      path: '/extension',
      headers: requestHeaders,
    })) {
      closeSocket({ socket: server, code: CLOSE_FAILED_TO_CONTACT, reason: 'Failed to contact remote browser' })
      return new Response(null, { status: 101, webSocket: client, headers: responseHeaders })
    }

    this.pendingDownstreams.set(
      connectionId,
      setTimeout(() => {
        this.pendingDownstreams.delete(connectionId)
        closeSocket({ socket: server, code: CLOSE_LOCAL_TIMEOUT, reason: 'Remote browser connection timeout' })
      }, DOWNSTREAM_OPEN_TIMEOUT_MS),
    )
    return new Response(null, { status: 101, webSocket: client, headers: responseHeaders })
  }

  private getUpstream(): WebSocket | null {
    const sockets = this.ctx.getWebSockets('upstream')
    return sockets.reduce<{ socket: WebSocket; connectedAt: number } | null>((latest, socket) => {
      const attachment = socket.deserializeAttachment() as SocketAttachment | undefined
      if (attachment?.role !== 'upstream') {
        return latest
      }
      if (!latest || attachment.connectedAt >= latest.connectedAt) {
        return { socket, connectedAt: attachment.connectedAt }
      }
      return latest
    }, null)?.socket || null
  }

  private sendToUpstream(upstream: WebSocket, message: TraforoUpstreamMessage): boolean {
    if (sendSocket({ socket: upstream, data: JSON.stringify(message) })) {
      return true
    }
    if (this.getUpstream() === upstream) {
      closeSocket({ socket: upstream, code: CLOSE_INTERNAL_ERROR, reason: 'Network connection lost' })
      this.disconnectDownstreams()
    }
    return false
  }

  private handleUpstreamMessage(rawMessage: string): void {
    const message: TraforoDownstreamMessage | null = (() => {
      try {
        return JSON.parse(rawMessage) as TraforoDownstreamMessage
      } catch {
        return null
      }
    })()
    if (!message) {
      return
    }

    if (message.type === 'ws_opened') {
      this.clearDownstreamTimeout(message.connId)
      return
    }
    if (message.type === 'ws_frame') {
      const downstream = this.getDownstream(message.connId)
      if (downstream && !message.binary) {
        sendSocket({ socket: downstream, data: message.data })
      }
      return
    }
    if (message.type === 'ws_closed') {
      this.clearDownstreamTimeout(message.connId)
      const downstream = this.getDownstream(message.connId)
      if (downstream) {
        closeSocket({ socket: downstream, code: message.code, reason: message.reason })
      }
      return
    }
    if (message.type === 'ws_error') {
      this.clearDownstreamTimeout(message.connId)
      const downstream = this.getDownstream(message.connId)
      if (downstream) {
        closeSocket({ socket: downstream, code: CLOSE_LOCAL_WS_ERROR, reason: message.error })
      }
    }
  }

  private getDownstream(connectionId: string): WebSocket | null {
    return this.ctx.getWebSockets(`connection:${connectionId}`)[0] || null
  }

  private clearDownstreamTimeout(connectionId: string): void {
    const timeout = this.pendingDownstreams.get(connectionId)
    if (timeout) {
      clearTimeout(timeout)
      this.pendingDownstreams.delete(connectionId)
    }
  }

  private disconnectDownstreams(): void {
    this.pendingDownstreams.forEach((timeout) => {
      clearTimeout(timeout)
    })
    this.pendingDownstreams.clear()
    this.ctx.getWebSockets('downstream').forEach((socket) => {
      closeSocket({ socket, code: CLOSE_SERVICE_RESTART, reason: 'Remote browser disconnected' })
    })
  }
}

function createClosingWebSocketResponse({
  code,
  reason,
  headers,
}: {
  code: number
  reason: string
  headers?: Headers
}): Response {
  const [client, server] = Object.values(new WebSocketPair())
  server.accept()
  closeSocket({ socket: server, code, reason })
  return new Response(null, { status: 101, webSocket: client, headers })
}

function sendSocket({ socket, data }: { socket: WebSocket; data: string }): boolean {
  try {
    socket.send(data)
    return true
  } catch {
    return false
  }
}

function closeSocket({ socket, code, reason }: { socket: WebSocket; code: number; reason: string }): void {
  try {
    socket.close(code, reason)
  } catch {}
}
