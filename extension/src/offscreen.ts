/**
 * Offscreen document for extension-owned clipboard writes and menu sounds.
 * Manifest V3 service workers have no DOM clipboard and no Web Audio, so the
 * service worker sends copyText and playSound messages here.
 */

import type {
  OffscreenMessage,
  OffscreenCopyTextMessage,
  OffscreenCopyTextResult,
  OffscreenPlaySoundMessage,
  OffscreenPlaySoundResult,
  SoundName,
} from './offscreen-types'

const OFFSCREEN_ACTIONS = new Set<OffscreenMessage['action']>(['copyText', 'playSound'])

type OffscreenResult = OffscreenCopyTextResult | OffscreenPlaySoundResult

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  if (!OFFSCREEN_ACTIONS.has(message.action)) {
    return false
  }
  void handleMessage(message).then(sendResponse)
  return true // Keep channel open for async response
})

async function handleMessage(message: OffscreenMessage): Promise<OffscreenResult> {
  switch (message.action) {
    case 'copyText':
      return handleCopyText(message)
    case 'playSound':
      return handlePlaySound(message)
  }
}

// Sounds are synthesized live with Web Audio, no audio files.
// Recipes from https://github.com/Danilaa1/cuelume
type SoundLayer =
  | {
      kind: 'tone'
      waveform: OscillatorType
      frequency: number
      glideTo?: number
      glideTime?: number
      offset?: number
      attack: number
      decay: number
      peak: number
    }
  | {
      kind: 'noise'
      filterType: BiquadFilterType
      filterFreq: number
      filterQ: number
      offset?: number
      attack: number
      decay: number
      peak: number
    }

interface SoundRecipe {
  masterGain: number
  layers: SoundLayer[]
  shimmer: { delay: number; feedback: number; wet: number; lowpass: number }
}

const SOUND_RECIPES: Record<SoundName, SoundRecipe> = {
  // Three-note ascending confirmation, played after clipboard copies.
  success: {
    masterGain: 0.5,
    layers: [
      { kind: 'tone', waveform: 'sine', frequency: 880, attack: 0.004, decay: 0.09, peak: 0.06 },
      { kind: 'tone', waveform: 'sine', frequency: 1108.73, offset: 0.06, attack: 0.004, decay: 0.1, peak: 0.06 },
      { kind: 'tone', waveform: 'sine', frequency: 1318.51, offset: 0.12, attack: 0.004, decay: 0.18, peak: 0.07 },
    ],
    shimmer: { delay: 0.1, feedback: 0.22, wet: 0.16, lowpass: 4500 },
  },
}

let audioContext: AudioContext | null = null

function renderSound(ctx: AudioContext, recipe: SoundRecipe): void {
  const now = ctx.currentTime
  const output = ctx.createGain()
  output.gain.value = 4
  output.connect(ctx.destination)
  const master = ctx.createGain()
  master.gain.value = recipe.masterGain
  master.connect(output)

  const { shimmer } = recipe
  const delay = ctx.createDelay(1)
  delay.delayTime.value = shimmer.delay
  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = shimmer.lowpass
  const feedback = ctx.createGain()
  feedback.gain.value = shimmer.feedback
  const wet = ctx.createGain()
  wet.gain.value = shimmer.wet
  master.connect(delay)
  delay.connect(lowpass).connect(feedback).connect(delay)
  lowpass.connect(wet).connect(output)

  recipe.layers.forEach((layer) => {
    const start = now + (layer.offset || 0)
    const duration = layer.attack + layer.decay + 0.05
    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(layer.peak, start + layer.attack)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + layer.attack + layer.decay)
    envelope.connect(master)

    if (layer.kind === 'tone') {
      const oscillator = ctx.createOscillator()
      oscillator.type = layer.waveform
      oscillator.frequency.setValueAtTime(layer.frequency, start)
      if (layer.glideTo) {
        oscillator.frequency.exponentialRampToValueAtTime(layer.glideTo, start + (layer.glideTime || duration))
      }
      oscillator.connect(envelope)
      oscillator.start(start)
      oscillator.stop(start + duration)
      return
    }

    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(duration * ctx.sampleRate)), ctx.sampleRate)
    const samples = buffer.getChannelData(0)
    samples.forEach((_, index) => {
      samples[index] = 2 * Math.random() - 1
    })
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = layer.filterType
    filter.frequency.value = layer.filterFreq
    filter.Q.value = layer.filterQ
    source.connect(filter).connect(envelope)
    source.start(start)
    source.stop(start + duration)
  })
}

async function handlePlaySound(message: OffscreenPlaySoundMessage): Promise<OffscreenPlaySoundResult> {
  try {
    audioContext ||= new AudioContext()
    if (audioContext.state !== 'running') {
      await audioContext.resume()
    }
    renderSound(audioContext, SOUND_RECIPES[message.sound])
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function handleCopyText(message: OffscreenCopyTextMessage): Promise<OffscreenCopyTextResult> {
  try {
    const textarea = document.querySelector<HTMLTextAreaElement>('#clipboard-text')
    if (!textarea) {
      return { success: false, error: 'Clipboard textarea is missing' }
    }
    textarea.value = message.text
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.value = ''
    if (!copied) {
      return { success: false, error: 'Clipboard copy command failed' }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

console.log('Playwriter offscreen document loaded')
