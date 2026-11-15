# Recording is active — how to turn it into a skill

The user is performing a workflow in their browser. Clicks, fills, keypresses,
navigations, mutating xhr/fetch, same-origin GET xhr/fetch, and toast or alert
text are written to a JSON event file. CDP
screencast writes a jpeg into a frames folder whenever the page changes. User
clicks flash a short ripple in those frames. Recording auto-stops after 20 minutes or
500 MB of frames and events (`reason: "max-size"`).

The end goal: a **skill** (`SKILL.md` plus an importable utils script) that
replays the flow with **playwriter** commands. Never drive the browser with raw
Playwright or `npx playwright`.

## First: read how Playwriter works

Do this once per session, **before** any playwriter command. Read the full output.
Never pipe through `head`, `tail`, `sed`, or any truncation:

```bash
playwriter skill
```

Or fetch https://playwriter.dev/SKILL.md (same content). Always use the **playwriter**
CLI after that (`playwriter -s <id> -e '...'`). Context variables (`context`,
`state`, `snapshot`, …) only exist inside that sandbox. There is no `page` global:
store the tab you work on in `state.page`.

## While the user records

Stay with the user. You may run playwriter commands on this session if they ask
(snapshot, inspect, click something). If they did not ask, ask first. Do not drive
the workflow yourself.

Tell the user: take your time, pauses and mistakes are fine. Dead ends can be
filtered out later.

When the user says stop/done:

```bash
playwriter recorder stop
```

If that errors because more than one recording is active, the message lists
each recording id with its current or last page URL. Pick the one that matches
this workflow (or ask the user), then `playwriter recorder stop <id>`.

## Inspect the events

`recorder events` prints one JSON object per line (jq-friendly). `t` is seconds
since start. Every event has a sequential `id` and `ms` (milliseconds since start).
The default output is a **thin timeline**: stored network bodies are replaced by
sizes, and runs of identical consecutive requests are merged into one event with
`repeat` and `lastId`. Pass event ids to get sanitized details. Credential-like
URL and body fields are replaced with `[redacted]`. Large, unknown-size, and
multipart bodies can be truncated or omitted. Defaults to the latest recording;
pass `-r <recordingId>` for an older one.

`network` and `toast` events carry `afterAction`: the id of the action that
happened up to 3s before them. Use it to map each click to its requests.

```bash
# thin timeline
playwriter recorder events | jq -r '[.id, .t, .type, (.code // .url // .signal // .message // .kind // empty)] | @tsv'

# full details of specific events
playwriter recorder events 4 7 12

# why a step failed: status >= 400, network failures, console and page errors, toasts
playwriter recorder events --errors

# hide noisy endpoints
playwriter recorder events --exclude 'StylesService|/track'

# recorded actions only
playwriter recorder events | jq -r 'select(.type == "action") | .code'

# xhr/fetch: mutating ones from any origin, GETs from the page origin. Thin view shows sizes.
# WebSockets are not recorded. A submit click with no matching POST is a hint.
playwriter recorder events | jq -r 'select(.type == "network") | [.id, .method, .status, .url, .responseBodySize] | @tsv'
playwriter recorder events 14 15

# downloads, uploads, console errors, page errors
playwriter recorder events | jq 'select(.type == "download" or .type == "console" or .type == "page-error" or (.type == "action" and .action == "setInputFiles"))'
```

Event types: `recording-started`, `action` (`.code` is locator code such as
`await page.getByRole('button', { name: 'Submit' }).click()`, where `page` is the
tab the event came from), `signal`,
`navigation`, `page-opened`, `page-closed`, `network` (mutating xhr/fetch, plus
GET xhr/fetch to the page origin, with sanitized, bounded body data; **WebSockets
are not captured**), `toast` (new text in `role=alert`, `role=status` or
`aria-live` regions: `role`, `text`), `download`, `console`, `page-error`,
`recording-stopped` (includes `framesDir` and `frameCount`).

A click with a `toast` but no request usually means the site refused the step on
the client (limits, validation). The toast text says why.

Action events also carry structured fields copied from Playwright: `text` (fill),
`key` (press), `options` (select), `files` (setInputFiles), `button` and
`modifiers` (click/press). Fill values use `[redacted]` in both `text` and
`.code`. Treat each one as an input parameter. Prefer structured fields over
parsing `.code`.

Drop select-all / modifier keypresses that happen just before a fill. They are
noise. The fill already has the final text.

Role names in generated locators may be prefixes of the live accessible name.
They still match. Verify against a live snapshot before trusting them.

## Frames

`framesDir` on the start/stop events is a folder of jpegs
(`~/.playwriter/recordings/<id>/frames`). Chrome only writes a frame when the
page changes. Files are named `<ms>.jpg` where `ms` is milliseconds since start.
Every event has the same `ms` field.

To see the screen at an event, print its frame path and open that image. A pink
ripple marks the click. Do not write awk/ls pipelines.

```bash
playwriter recorder frame 42               # screen when event 42 happened
playwriter recorder frame 42 --offset 1500 # result of the click, 1.5s later
```

## Prototype against the live page

Do not trust recorded locators blindly. Use the same playwriter session. First
pick the tab the user recorded in (last match = most recently opened):

```bash
playwriter -s <session> -e 'state.page = context.pages().findLast((p) => p.url().includes("directory.example.com"))'
playwriter -s <session> -e 'console.log(await snapshot({ page: state.page }))'
playwriter -s <session> -e 'await state.page.getByRole("button", { name: "Submit" }).click()'
```

Loop: snapshot → run one recorded action → snapshot again. Drop actions the user
flagged as mistakes.

## Write the skill

Guess sensible defaults from the events (name, location, use case, parameters)
and **write the skill**. Then tell the user what you assumed. Demo values the
user typed should almost always be parameters, not hardcoded strings.

Use the [Agent Skills](https://agentskills.io) default locations, not a
client-specific folder such as `~/.config/opencode/skills/`:

- personal (all projects): `~/.agents/skills/<name>/`
- project-local: `.agents/skills/<name>/` in the current repo

Write **`SKILL.md`** plus a helper script in that directory. Name the
script for what it does (`submit.js`, `sdk.js`). Do not default to
`utils.js`.

`SKILL.md` frontmatter has `name` and `description` (when to load the skill).
The body explains the flow as **markdown instructions with example playwriter
commands** built from the recorded events:

````markdown
---
name: submit-to-directory
description: >
  Submit a product to the directory. Use when the user wants to add or update
  a listing on directory.example.com.
---

# Submit to directory

Preconditions: the user is already signed in. Playwriter drives their browser.

1. Open the submit page

```bash
playwriter -s 1 -e 'state.page = await context.newPage(); await state.page.goto("https://directory.example.com/submit")'
```

2. Fill the product name (parameter), then the website URL

```bash
playwriter -s 1 -e 'const name = "Acme"; await state.page.getByRole("textbox", { name: "Product name" }).fill(name)'
playwriter -s 1 -e 'const url = "https://acme.com"; await state.page.getByRole("textbox", { name: "Website URL" }).fill(url)'
```

3. Click Submit. Expect POST `/api/products` and confirmation text.

```bash
playwriter -s 1 -e 'await state.page.getByRole("button", { name: "Submit" }).click()'
playwriter -s 1 -e 'await state.page.getByText("Thanks! Your product is under review.").waitFor()'
```

Or import the helper script (preferred for replay; fewer tokens).
Never put a machine-specific absolute path in SKILL.md or the script.
Relative to the playwriter cwd for a project skill:

```bash
playwriter -s 1 -e 'const { submitProduct } = await import("./.agents/skills/submit-to-directory/submit.js"); state.page ??= await context.newPage(); await submitProduct({ page: state.page, name, url })'
```

For a personal skill, resolve the home directory at runtime:

```bash
playwriter -s 1 -e 'const { join } = require("node:path"); const { homedir } = require("node:os"); const { submitProduct } = await import(join(homedir(), ".agents/skills/submit-to-directory/submit.js")); state.page ??= await context.newPage(); await submitProduct({ page: state.page, name, url })'
```
````

The helper is an importable ESM script. Name it for the flow. For UI replay,
export functions that accept `{ page }` plus parameters. For a recorded JSON
API, export a class from `sdk.js` (see below). The playwriter sandbox can
import local files.

Rules:

- Always `playwriter -s <id> -e '...'`. Never raw Playwright.
- Use locators verified against the live page. Recorded `.code` is the starting point.
- After each action, wait for the outcome seen in the events (`waitForURL`,
  `locator.waitFor`, or the mutating network request). No blind sleeps.
- Parameterize demo-typed values. Keep everything else literal.
- Never hardcode absolute filesystem paths (`/Users/...`, `C:\...`, `/abs/path/...`)
  in SKILL.md or helper scripts. Relative import from the playwriter cwd, or
  `join(homedir(), '.agents/skills/<name>/<script>.js')`.
- If the flow needs auth, check a signed-in indicator first and tell the user
  to log in if it is missing.
- Never hardcode secrets, cookies, or tokens.
- If a cookie banner / modal sometimes appears, detect it, dismiss it, retry
  once. Do not add generic retry loops.
- Throw or print a clear error when an expected outcome does not appear.

If recorded `network` events show a clean fetch/XHR JSON API, write an in-page
SDK (next section). Prefer UI automation when the API is unclear.

## In-page XHR SDK

When the recording has mutating xhr/fetch with JSON bodies, **do not click
through the UI**. Write a small JS SDK and call those endpoints from
`page.evaluate`. The request then runs in the real tab: cookies, captchas,
Cloudflare, and the TLS fingerprint stay in the browser.

Put the SDK in **`sdk.js`** next to `SKILL.md` (or another name that matches
the site, like `directory-sdk.js`). Use a **class**. Pass shared handles in
the constructor (`page`, origin). Methods take **one object argument**.
Annotate inputs and returns with **JSDoc comments**. For a typed SDK that
other code imports outside playwriter, see "Standalone TypeScript SDK" below.

Never call the site API with Node `fetch`. Node has no session cookies and
trips bot checks.

```js
/**
 * @typedef {{ page: { evaluate: Function, url: () => string, goto: Function } }} ClientOptions
 * @typedef {{ name: string, url: string }} SubmitProductInput
 * @typedef {{ id: string, status: string }} SubmitProductResult
 */

export class DirectoryClient {
  /** @param {ClientOptions} opts */
  constructor({ page }) {
    this.page = page
  }

  /**
   * @param {{ path: string, method?: string, body?: unknown }} args
   * @returns {Promise<unknown>}
   */
  async request({ path, method = 'POST', body }) {
    return await this.page.evaluate(
      async ({ path, method, body }) => {
        const res = await fetch(path, {
          method,
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        const text = await res.text()
        if (!res.ok) {
          throw new Error(`${method} ${path} failed: ${res.status} ${text}`)
        }
        if (!text) {
          return null
        }
        try {
          return JSON.parse(text)
        } catch {
          return text
        }
      },
      { path, method, body },
    )
  }

  /**
   * @param {SubmitProductInput} input
   * @returns {Promise<SubmitProductResult>}
   */
  async submitProduct({ name, url }) {
    return await this.request({
      path: '/api/products',
      body: { name, url },
    })
  }
}
```

Replay:

```bash
playwriter -s 1 -e 'const { DirectoryClient } = await import("./.agents/skills/submit-to-directory/sdk.js"); state.page ??= await context.newPage(); const client = new DirectoryClient({ page: state.page }); console.log(await client.submitProduct({ name: "Acme", url: "https://acme.com" }))'
```

Rules:

- One `request` helper on the class. Every method goes through it.
- Throw on non-OK. The message must include **method, path, status, and
  response text** so a later agent can debug without re-recording.
- Use the safe structure from recorded `network` events. Treat redacted,
  truncated, or omitted values as parameters that must be supplied or fetched.
- Open the site origin first so `fetch('/api/...')` is same-origin.
- If a call needs a prior id or csrf token, fetch that in another method and
  pass it through the constructor or as a method arg. Do not hardcode tokens.

## Standalone TypeScript SDK

Use this when the user wants a typed SDK that other code imports (a script, a
bot, a cron job), not only replay inside `playwriter -e`. Write `sdk.ts` and
connect with the `playwriter` package. Docs:
https://playwriter.dev/docs/sessions#node-api

```ts
import { connectViaExtension } from 'playwriter'

export interface Product {
  id: string
  name: string
}

export async function listProducts(): Promise<Product[]> {
  // throws a clear "install the Playwriter extension" error if Chrome is not connected.
  // `await using` disconnects and deletes the session at scope end, also on throw.
  await using connection = await connectViaExtension({ tabGroup: 'directory' })
  // the connection never closes tabs: `await using page` closes the tab this function opened.
  await using page = await connection.browser.contexts()[0].newPage()
  await page.goto('https://directory.example.com', { waitUntil: 'domcontentloaded' })
  return await page.evaluate(async () => {
    const res = await fetch('/api/products', { credentials: 'include' })
    if (!res.ok) throw new Error(`GET /api/products failed: ${res.status} ${await res.text()}`)
    return await res.json()
  })
}
```

Rules:

- `playwriter` must be a dependency of the project that runs `sdk.ts`.
- Export typed interfaces for every input and return value.
- Always `await using connection = ...` and `await using page = ...` for every tab the SDK opens. The connection does not close tabs. Never leave tabs or sessions open.
- `fetch` still runs inside `page.evaluate`, same as the JS SDK.
- Validate by running the SDK with `tsx` or `bun` end-to-end.

## WebSockets are not in the recording

The recorder stores xhr/fetch only. It does **not** store `WebSocket`
frames. A listen socket may already be open before `recorder
start` (SPA already on the page). Generate / stream work often never
appears as a `network` event.

If the user submitted or started a job and the events have **no POST that
matches that action** (only analytics, quota, billing), do not stop at REST.

A listen socket is often already open. **Install a tap, then reload**, so
the page's own `new WebSocket` goes through your wrapper. `page.evaluate`
alone is too late. `addInitScript` survives the reload.

```bash
playwriter -s 1 -e '
/**
 * @typedef {"construct" | "send" | "message" | "close" | "error"} WsTapKind
 * @typedef {{ t: number, kind: WsTapKind, url: string, data?: string }} WsTapEvent
 */

await state.page.addInitScript(() => {
  const g = /** @type {typeof globalThis & { __wsTap?: WsTapEvent[] }} */ (globalThis)
  if (g.__wsTap) {
    return
  }
  /** @type {WsTapEvent[]} */
  const tap = []
  g.__wsTap = tap
  const NativeWebSocket = WebSocket
  g.WebSocket = class TappedWebSocket extends NativeWebSocket {
    /**
     * @param {string | URL} url
     * @param {string | string[]=} protocols
     */
    constructor(url, protocols) {
      super(url, protocols)
      const href = String(url)
      /**
       * @param {WsTapKind} kind
       * @param {string} [data]
       */
      const push = (kind, data) => {
        tap.push({ t: Date.now(), kind, url: href, data })
      }
      push("construct")
      const send = this.send.bind(this)
      this.send = (data) => {
        const text = typeof data === "string" ? data.slice(0, 4000) : `[${data?.constructor?.name || "binary"}]`
        push("send", text)
        return send(data)
      }
      this.addEventListener("message", (ev) => {
        push("message", typeof ev.data === "string" ? ev.data.slice(0, 4000) : "[binary]")
      })
      this.addEventListener("close", () => {
        push("close")
      })
      this.addEventListener("error", () => {
        push("error")
      })
    }
  }
})
await state.page.reload({ waitUntil: "domcontentloaded" })
'

# replay the user action (submit, generate, …), then dump the tap
playwriter -s 1 -e '
/**
 * @typedef {{ t: number, kind: string, url: string, data?: string }} WsTapEvent
 * @type {WsTapEvent[]}
 */
const events = await state.page.evaluate(() => {
  return globalThis.__wsTap || []
})
console.log(JSON.stringify(events, null, 2))
'
```

Note: `addInitScript` + reload is required. Wrapping `WebSocket` after load
misses the socket the page already opened. After reload the tap is often
`[]` until you **replay the user action** (submit, generate). That is not
a failed wrap. Check `WebSocket.name === "TappedWebSocket"` if you need
to confirm the hook. The typedefs are for the agent and for later
`sdk.js` methods. Code inside `evaluate` / `addInitScript` must stay
erasable JS (JSDoc only).

Then grep scripts if the tap is empty:
`createEditor({ cdp }).grep({ regex: /wss:\\/\\/|new WebSocket/ })`.
Search public reverse-engineering only after the page scripts.

Add a class method on `sdk.js` that opens or reuses that socket **inside
`page.evaluate`**, same as fetch. Do not connect from Node. Cookies and
Cloudflare stay on the tab.

A `quota_info` / credits POST after submit is not the generate call. Keep
looking.

## Validate

The skill is not done until replay succeeds end-to-end with test parameters.
Prefer replaying the helper script. If that fails, snapshot the live page, fix
the locator or wait, and run again.

## Updating an existing skill

If a similar skill already exists (check the location first), update it instead
of creating a new one: read the current SKILL.md and helper scripts, re-record
or compare locators, fix the root cause, keep working parts, re-validate.

## Checklist

- Locators come from recorded events and were verified live
- Every step has a verifiable outcome
- Demo-typed values are parameters
- Waits reflect real timing (user remarks + event gaps)
- Secrets are never hardcoded
- No absolute filesystem paths in SKILL.md or helper scripts
- Replay uses playwriter commands (inline `-e` or an imported helper script)
- XHR skills use an in-page class SDK; fetch errors include status and body
- Standalone `sdk.ts` uses `await using connection = await connectViaExtension()`
- The flow was validated end-to-end at least once
