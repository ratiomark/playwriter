// Verifies the remote-control tunnel protocol with real workerd WebSockets.

import { env } from 'cloudflare:workers'
import { describe, expect, test } from 'vitest'
import { routeRemoteControlRequest } from './remote-control-tunnel.ts'

function requireWebSocket(response: Response): WebSocket {
  const socket = response.webSocket
  if (!socket) {
    throw new Error(`Expected WebSocket upgrade, got ${response.status}`)
  }
  socket.accept()
  return socket
}

function waitForMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('error', onError)
    }
    const onMessage = (event: MessageEvent) => {
      cleanup()
      if (typeof event.data !== 'string') {
        reject(new Error('Expected a text WebSocket frame'))
        return
      }
      resolve(event.data)
    }
    const onError = () => {
      cleanup()
      reject(new Error('WebSocket error before message'))
    }
    socket.addEventListener('message', onMessage)
    socket.addEventListener('error', onError)
  })
}

function waitForClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener('close', onClose)
      socket.removeEventListener('error', onError)
    }
    const onClose = (event: CloseEvent) => {
      cleanup()
      resolve(event)
    }
    const onError = () => {
      cleanup()
      reject(new Error('WebSocket error before close'))
    }
    socket.addEventListener('close', onClose)
    socket.addEventListener('error', onError)
  })
}

async function openTunnelSocket({
  stub,
  path,
}: {
  stub: DurableObjectStub
  path: string
}): Promise<WebSocket> {
  const response = await stub.fetch(`https://remote-control.test${path}`, {
    headers: { Upgrade: 'websocket' },
  })
  return requireWebSocket(response)
}

async function openRoutedTunnelSocket({
  tunnelId,
  path,
}: {
  tunnelId: string
  path: string
}): Promise<WebSocket> {
  const response = await routeRemoteControlRequest({
    request: new Request(`https://${tunnelId}-tunnel.playwriter.dev${path}`, {
      headers: { Upgrade: 'websocket' },
    }),
    env,
  })
  if (!response) {
    throw new Error('Expected the remote-control request to be routed')
  }
  return requireWebSocket(response)
}

describe('remote control tunnel', () => {
  test('relays extension protocol frames in both directions', async () => {
    const tunnelId = crypto.randomUUID()
    const upstream = await openRoutedTunnelSocket({ tunnelId, path: '/traforo-upstream' })

    expect(JSON.parse(await waitForMessage(upstream))).toEqual({ type: 'upstream_accepted' })

    const openMessagePromise = waitForMessage(upstream)
    const downstream = await openRoutedTunnelSocket({ tunnelId, path: '/extension' })
    const openMessage = JSON.parse(await openMessagePromise) as {
      type: string
      connId: string
      path: string
    }
    expect(openMessage).toMatchObject({ type: 'ws_open', path: '/extension' })

    upstream.send(JSON.stringify({ type: 'ws_opened', connId: openMessage.connId }))

    const upstreamFramePromise = waitForMessage(upstream)
    downstream.send('{"id":1,"method":"ping"}')
    expect(JSON.parse(await upstreamFramePromise)).toEqual({
      type: 'ws_frame',
      connId: openMessage.connId,
      data: '{"id":1,"method":"ping"}',
      binary: false,
    })

    const downstreamFramePromise = waitForMessage(downstream)
    upstream.send(
      JSON.stringify({
        type: 'ws_frame',
        connId: openMessage.connId,
        data: '{"id":1,"result":"pong"}',
        binary: false,
      }),
    )
    expect(await downstreamFramePromise).toBe('{"id":1,"result":"pong"}')

    const closeMessagePromise = waitForMessage(upstream)
    downstream.close(1000, 'agent disconnected')
    expect(JSON.parse(await closeMessagePromise)).toEqual({
      type: 'ws_close',
      connId: openMessage.connId,
      code: 1000,
      reason: 'agent disconnected',
    })

    upstream.close(1000, 'done')
  })

  // Keepalives must be auto-answered: relaying them wakes the DO and keeps it
  // billed 24/7 (old relays ping every 5s).
  test('answers keepalive pings without relaying them', async () => {
    const tunnelId = crypto.randomUUID()
    const upstream = await openRoutedTunnelSocket({ tunnelId, path: '/traforo-upstream' })
    await waitForMessage(upstream)
    const openMessagePromise = waitForMessage(upstream)
    const downstream = await openRoutedTunnelSocket({ tunnelId, path: '/extension' })
    const openMessage = JSON.parse(await openMessagePromise) as { connId: string }
    upstream.send(JSON.stringify({ type: 'ws_opened', connId: openMessage.connId }))

    const upstreamMessages: string[] = []
    upstream.addEventListener('message', (event) => {
      upstreamMessages.push(String(event.data))
    })

    const downstreamPong = waitForMessage(downstream)
    downstream.send('{"method":"ping"}')
    expect(await downstreamPong).toBe('{"method":"pong"}')

    const upstreamPong = waitForMessage(upstream)
    upstream.send('{"method":"ping"}')
    expect(await upstreamPong).toBe('{"method":"pong"}')
    expect(upstreamMessages).toEqual(['{"method":"pong"}'])

    upstream.close(1000, 'done')
  })

  // Path-based tunneling keeps the id out of DNS/SNI: the same playwriter.dev
  // worker serves /tunnel/{id}/upstream and /tunnel/{id}/extension.
  test('routes path-based tunnel urls on the main domain', async () => {
    const tunnelId = crypto.randomUUID()
    const upstreamResponse = await routeRemoteControlRequest({
      request: new Request(`https://playwriter.dev/tunnel/${tunnelId}/upstream`, {
        headers: { Upgrade: 'websocket' },
      }),
      env,
    })
    if (!upstreamResponse) {
      throw new Error('Expected the upstream request to be routed')
    }
    const upstream = requireWebSocket(upstreamResponse)
    expect(JSON.parse(await waitForMessage(upstream))).toEqual({ type: 'upstream_accepted' })

    const openMessagePromise = waitForMessage(upstream)
    const downstreamResponse = await routeRemoteControlRequest({
      request: new Request(`https://playwriter.dev/tunnel/${tunnelId}/extension`, {
        headers: { Upgrade: 'websocket' },
      }),
      env,
    })
    if (!downstreamResponse) {
      throw new Error('Expected the downstream request to be routed')
    }
    const downstream = requireWebSocket(downstreamResponse)
    const openMessage = JSON.parse(await openMessagePromise) as { connId: string }
    expect(openMessage).toMatchObject({ type: 'ws_open', path: '/extension' })
    upstream.send(JSON.stringify({ type: 'ws_opened', connId: openMessage.connId }))

    // A second downstream on the subdomain form must reach the SAME upstream:
    // both forms resolve the same id to the same DO.
    const secondOpenPromise = waitForMessage(upstream)
    const secondDownstream = await openRoutedTunnelSocket({ tunnelId, path: '/extension' })
    const secondOpen = JSON.parse(await secondOpenPromise) as { connId: string }
    expect(secondOpen.connId).not.toBe(openMessage.connId)
    upstream.send(JSON.stringify({ type: 'ws_opened', connId: secondOpen.connId }))

    // the frame flows through the same upstream, back to the same downstream
    const secondFramePromise = waitForMessage(secondDownstream)
    secondDownstream.send('{"id":9,"method":"ping"}')
    const frame = JSON.parse(await waitForMessage(upstream)) as { connId: string }
    expect(frame.connId).toBe(secondOpen.connId)
    upstream.send(
      JSON.stringify({ type: 'ws_frame', connId: secondOpen.connId, data: '{"id":9,"result":"pong"}', binary: false }),
    )
    expect(await secondFramePromise).toBe('{"id":9,"result":"pong"}')

    upstream.close(1000, 'done')
  })

  test('tunnel paths that are not exactly /tunnel/{id}/upstream or /extension are not tunnels', async () => {
    for (const badPath of ['/tunnel/abc123', '/tunnel/abc123/typo', '/tunnel/abc123/a/b', '/tunnel/abc123/extension/extra']) {
      // null = fall through to the normal site app, which 404s unknown pages
      const response = await routeRemoteControlRequest({
        request: new Request(`https://playwriter.dev${badPath}`, {
          headers: { Upgrade: 'websocket' },
        }),
        env,
      })
      expect(response, badPath).toBeNull()
    }
  })

  // Relays redial offline tunnels in a loop. Holding the request open while
  // waiting for an upstream kept the DO awake (billed) for most of every cycle.
  test('closes a dial with 4008 at once when no upstream is connected', async () => {
    const stub = env.REMOTE_CONTROL_TUNNEL.get(env.REMOTE_CONTROL_TUNNEL.idFromName(crypto.randomUUID()))
    const startedAt = Date.now()
    const response = await stub.fetch('https://remote-control.test/extension', {
      headers: { Upgrade: 'websocket' },
    })
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    const socket = response.webSocket
    if (!socket) {
      throw new Error(`Expected WebSocket upgrade, got ${response.status}`)
    }
    const closePromise = waitForClose(socket)
    socket.accept()
    await expect(closePromise).resolves.toMatchObject({ code: 4008 })
  })

  test('rejects a second upstream and drops downstreams when sharing stops', async () => {
    const id = env.REMOTE_CONTROL_TUNNEL.idFromName(crypto.randomUUID())
    const stub = env.REMOTE_CONTROL_TUNNEL.get(id)
    const upstream = await openTunnelSocket({ stub, path: '/traforo-upstream' })
    await waitForMessage(upstream)

    const rejectedResponse = await stub.fetch('https://remote-control.test/traforo-upstream', {
      headers: { Upgrade: 'websocket' },
    })
    if (!rejectedResponse.webSocket) {
      throw new Error(`Expected rejected WebSocket upgrade, got ${rejectedResponse.status}`)
    }
    const rejected = rejectedResponse.webSocket
    const rejectedClosePromise = waitForClose(rejected)
    rejected.accept()
    await expect(rejectedClosePromise).resolves.toMatchObject({ code: 4409 })

    const openMessagePromise = waitForMessage(upstream)
    const downstream = await openTunnelSocket({ stub, path: '/extension' })
    const openMessage = JSON.parse(await openMessagePromise) as { connId: string }
    upstream.send(JSON.stringify({ type: 'ws_opened', connId: openMessage.connId }))

    const downstreamClosePromise = waitForClose(downstream)
    upstream.close(1000, 'sharing stopped')
    await expect(downstreamClosePromise).resolves.toMatchObject({ code: 1012 })
  })
})
