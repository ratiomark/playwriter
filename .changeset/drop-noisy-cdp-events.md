---
'playwriter': patch
---

Drop high-frequency CDP events (`Network.dataReceived`, `*ExtraInfo`, `resourceChangedPriority`, `webSocketFrame*`, `requestServedFromCache`) at both relay and extension level before forwarding to Playwright clients.

Events needed by Playwright APIs (`requestWillBeSent`, `responseReceived`, `loadingFinished`, `loadingFailed`) are still forwarded.

Also batch log file writes (relay-server.log and cdp.jsonl) with a 500ms flush interval to reduce disk I/O under heavy event throughput.

Fixes #96
