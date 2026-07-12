---
'playwriter': minor
---

Add live RTMP streaming: stream a browser tab to X Live, Twitch, YouTube or any RTMP endpoint via ffmpeg.

Uses the same `chrome.tabCapture` pipeline as recording, so the stream survives page navigation and requires no extension update. The relay pipes capture chunks to an ffmpeg process (spawned inside the relay), which re-encodes in real time (H.264 + AAC; defaults match X Live's recommended encoder settings) and keeps running after the CLI exits — perfect for 24/7 streams.

New CLI commands:

```bash
# stream the session's current page; repeat --rtmp for simultaneous multi-streaming
playwriter stream start -s 1 --rtmp rtmp://va.pscp.tv:80/x/<stream-key>

# health: uptime, encoder fps, output bitrate, dropped frames
playwriter stream status -s 1

# graceful stop
playwriter stream stop -s 1
```

Defaults match X Live's recommended encoder settings: `--resolution 1920x1080`, `--fps 30`, `--video-bitrate 9000` (kbps), `--keyframe-interval 3` (seconds), `--audio-bitrate 128` (AAC 44100Hz stereo). Other options: `--no-audio` (injects a silent track — X Live requires audio), `--preset veryfast`, `--codec` (auto-detects hardware encoders, falls back to libx264). For Twitch use `--video-bitrate 6000 --keyframe-interval 2`.

New executor API available in `execute` code:

```js
await stream.start({ rtmpUrls: ['rtmp://va.pscp.tv:80/x/KEY'] })
await stream.status()
await stream.stop()
```

Stream keys are never logged: status output and relay logs only show redacted destinations like `rtmp://host/…`.
