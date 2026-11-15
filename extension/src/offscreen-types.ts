/**
 * Types for communication between background.ts and offscreen.ts.
 * These are Chrome extension internal messages, separate from the WS protocol types.
 */

export interface OffscreenCopyTextMessage {
  action: 'copyText'
  text: string
}

export type SoundName = 'success'

export interface OffscreenPlaySoundMessage {
  action: 'playSound'
  sound: SoundName
}

export type OffscreenMessage = OffscreenCopyTextMessage | OffscreenPlaySoundMessage

export type OffscreenCopyTextResult = { success: true } | { success: false; error: string }

export type OffscreenPlaySoundResult = { success: true } | { success: false; error: string }
