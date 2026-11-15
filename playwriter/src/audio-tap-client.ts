/**
 * Page audio tap for screen recording. Bundled as an IIFE (dist/audio-tap-client.js)
 * and injected into the MAIN world of the top frame with
 * Page.addScriptToEvaluateOnNewDocument, so it runs again after every navigation.
 *
 * Pattern from the udio export recipe: tap decoded audio with Web Audio and ship
 * PCM to Node. Everything the page plays is mixed into one recorder AudioContext:
 *
 *   <audio>/<video> ── captureStream() ── gain(volume, muted) ──┐
 *       DRM (EME): captureStream throws ── createMediaElementSource ┤
 *   page AudioContext ── node.connect(destination) also feeds ────┤
 *       a MediaStreamAudioDestination of that context                ▼
 *                                   recorder ctx: mix ── ScriptProcessor ── binding
 *
 * PCM is s16le stereo 48 kHz, sent as base64 through a CDP binding. Silent chunks
 * are skipped: Node fills gaps with silence on its own clock.
 *
 * The binding payload must be JSON shaped like a Playwright binding call
 * ({ name, seq, serializedArgs }): every Playwright client on the tab receives
 * Runtime.bindingCalled and JSON.parses the payload. With an unknown name they
 * ignore it.
 *
 * Limitations: audio of cross-origin iframes (other process) is not captured,
 * and an AudioContext graph wired before the tap starts is missed.
 */

type MediaElementWithCapture = HTMLMediaElement & {
  captureStream?: () => MediaStream
  mozCaptureStream?: () => MediaStream
}

const SAMPLE_RATE = 48000
const BUFFER_SIZE = 4096

interface TapState {
  /** Binding names of active captures. Several captures (a recording and a
   *  stream, other clients) share one audio graph. */
  subscribers: Set<string>
  teardown: () => void
}

const g = globalThis as typeof globalThis & {
  __playwriterAudioTapState?: TapState
  [key: string]: unknown
}

function startAudioTap(bindingName: string): void {
  if (window !== window.top) {
    return
  }
  if (g.__playwriterAudioTapState) {
    g.__playwriterAudioTapState.subscribers.add(bindingName)
    return
  }
  const NativeAudioContext = window.AudioContext
  if (!NativeAudioContext) {
    return
  }
  const subscribers = new Set([bindingName])

  type Connect = (this: AudioNode, destination: AudioNode, output?: number) => AudioNode
  type Disconnect = (this: AudioNode, destination?: AudioNode) => void
  const nativeConnect = AudioNode.prototype.connect
  const nativeDisconnect = AudioNode.prototype.disconnect
  const originalConnect = nativeConnect as Connect
  const originalDisconnect = nativeDisconnect as Disconnect
  const originalPlay = HTMLMediaElement.prototype.play
  const connect = (from: AudioNode, to: AudioNode) => {
    originalConnect.call(from, to)
  }

  const recorder = new NativeAudioContext({ sampleRate: SAMPLE_RATE })
  const mix = recorder.createGain()
  const processor = recorder.createScriptProcessor(BUFFER_SIZE, 2, 2)
  const mute = recorder.createGain()
  mute.gain.value = 0
  connect(mix, processor)
  connect(processor, mute)
  connect(mute, recorder.destination)

  processor.onaudioprocess = (event) => {
    const left = event.inputBuffer.getChannelData(0)
    const right = event.inputBuffer.getChannelData(1)
    const pcm = new Int16Array(left.length * 2)
    let silent = true
    for (let i = 0; i < left.length; i++) {
      const l = Math.max(-1, Math.min(1, left[i]))
      const r = Math.max(-1, Math.min(1, right[i]))
      if (l !== 0 || r !== 0) {
        silent = false
      }
      pcm[i * 2] = l * 0x7fff
      pcm[i * 2 + 1] = r * 0x7fff
    }
    if (silent) {
      return
    }
    const bytes = new Uint8Array(pcm.buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
    }
    const pcmBase64 = btoa(binary)
    subscribers.forEach((name) => {
      const send = g[name]
      if (typeof send === 'function') {
        send(JSON.stringify({ name, seq: 0, serializedArgs: [], pcm: pcmBase64 }))
      }
    })
  }

  // The recorder context starts suspended without user activation. Media that
  // plays audibly implies activation, so resume on play and on input.
  const resume = () => {
    if (recorder.state === 'suspended') {
      void recorder.resume().catch(() => {})
    }
  }

  const tappedElements = new WeakSet<HTMLMediaElement>()
  const tapElement = (element: HTMLMediaElement) => {
    if (tappedElements.has(element)) {
      return
    }
    const media = element as MediaElementWithCapture
    const stream = (() => {
      try {
        return media.captureStream?.() || media.mozCaptureStream?.() || null
      } catch {
        return null
      }
    })()
    if (!stream) {
      // DRM media throws "Stream capture not supported with EME". Routing the
      // element through our context is the only tap, and it binds the element to
      // it for good. Only do it while running, or the element would go silent.
      if (recorder.state !== 'running') {
        return
      }
      try {
        const source = recorder.createMediaElementSource(element)
        connect(source, recorder.destination)
        connect(source, mix)
        tappedElements.add(element)
      } catch {}
      return
    }
    tappedElements.add(element)
    // captureStream ignores muted and volume; mirror them so we record what plays
    const volume = recorder.createGain()
    const syncVolume = () => {
      volume.gain.value = element.muted ? 0 : element.volume
    }
    syncVolume()
    element.addEventListener('volumechange', syncVolume)
    connect(volume, mix)
    const sources = new Map<string, MediaStreamAudioSourceNode>()
    const syncTracks = () => {
      stream.getAudioTracks().forEach((track) => {
        if (sources.has(track.id)) {
          return
        }
        const source = recorder.createMediaStreamSource(new MediaStream([track]))
        connect(source, volume)
        sources.set(track.id, source)
      })
      Array.from(sources.entries()).forEach(([id, source]) => {
        if (!stream.getTrackById(id)) {
          originalDisconnect.call(source)
          sources.delete(id)
        }
      })
    }
    stream.addEventListener('addtrack', syncTracks)
    stream.addEventListener('removetrack', syncTracks)
    syncTracks()
  }

  const contextTaps = new WeakMap<BaseAudioContext, MediaStreamAudioDestinationNode>()
  const contextTap = (context: BaseAudioContext) => {
    const existing = contextTaps.get(context)
    if (existing || !(context instanceof NativeAudioContext)) {
      return existing
    }
    const tap = context.createMediaStreamDestination()
    connect(recorder.createMediaStreamSource(tap.stream), mix)
    contextTaps.set(context, tap)
    return tap
  }

  const patchedConnect = function (this: AudioNode, ...args: unknown[]) {
    const result = (nativeConnect as (...a: unknown[]) => unknown).apply(this, args)
    const [destination, output] = args
    if (destination instanceof AudioDestinationNode && this.context !== recorder) {
      try {
        const tap = contextTap(this.context)
        if (tap) {
          originalConnect.call(this, tap, typeof output === 'number' ? output : 0)
        }
      } catch {}
    }
    return result
  }
  const patchedDisconnect = function (this: AudioNode, ...args: unknown[]) {
    const result = (nativeDisconnect as (...a: unknown[]) => unknown).apply(this, args)
    const tap = args[0] instanceof AudioDestinationNode ? contextTaps.get(this.context) : undefined
    if (tap) {
      try {
        originalDisconnect.call(this, tap)
      } catch {}
    }
    return result
  }
  const patchedPlay = function (this: HTMLMediaElement) {
    resume()
    tapElement(this)
    return originalPlay.call(this)
  }
  AudioNode.prototype.connect = patchedConnect as typeof AudioNode.prototype.connect
  AudioNode.prototype.disconnect = patchedDisconnect as typeof AudioNode.prototype.disconnect
  HTMLMediaElement.prototype.play = patchedPlay

  const onPlay = (event: Event) => {
    resume()
    if (event.target instanceof HTMLMediaElement) {
      tapElement(event.target)
    }
  }
  const tapExisting = () => {
    document.querySelectorAll('audio, video').forEach((element) => {
      tapElement(element as HTMLMediaElement)
    })
  }
  document.addEventListener('play', onPlay, true)
  window.addEventListener('pointerdown', resume, true)
  window.addEventListener('keydown', resume, true)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tapExisting, { once: true })
  } else {
    tapExisting()
  }
  resume()

  const teardown = () => {
    if ((AudioNode.prototype.connect as unknown) === patchedConnect) {
      AudioNode.prototype.connect = nativeConnect
    }
    if ((AudioNode.prototype.disconnect as unknown) === patchedDisconnect) {
      AudioNode.prototype.disconnect = nativeDisconnect
    }
    if (HTMLMediaElement.prototype.play === patchedPlay) {
      HTMLMediaElement.prototype.play = originalPlay
    }
    document.removeEventListener('play', onPlay, true)
    window.removeEventListener('pointerdown', resume, true)
    window.removeEventListener('keydown', resume, true)
    processor.onaudioprocess = null
    originalDisconnect.call(processor)
  }
  g.__playwriterAudioTapState = { subscribers, teardown }
}

function stopAudioTap(bindingName: string): void {
  const state = g.__playwriterAudioTapState
  if (!state || !state.subscribers.delete(bindingName) || state.subscribers.size > 0) {
    return
  }
  delete g.__playwriterAudioTapState
  state.teardown()
}

g.__playwriterAudioTap = startAudioTap
g.__playwriterAudioTapStop = stopAudioTap
