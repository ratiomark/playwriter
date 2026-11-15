# Chrome Web Store Submission Justifications

## Single Purpose Description

Connects user-selected Chrome tabs to local or explicitly authorized remote
Playwright clients through Chrome DevTools Protocol for browser automation,
testing, debugging, recording, and remote support.

## Permission Justifications

### debugger

Essential for the extension's single purpose. Playwriter attaches Chrome DevTools
Protocol (CDP) only to tabs selected by the user, or to new tabs that an
authorized automation client opens. CDP provides page
navigation, element interaction, screenshots, accessibility data, network and
console inspection, JavaScript debugging, and user-requested script evaluation.

Remote control uses the same documented Debugger API. It gives the authorized
remote client the same access as a local client: every Playwriter-connected tab,
plus new tabs it opens. It is not a security sandbox. The user must click
**Share browser…** in the extension icon menu and accept a disclosure in an
extension window before the encrypted tunnel starts.

### scripting

Used only after the user clicks a Playwriter menu item to:

1. Pin the element the user right-clicked (**Copy Playwriter Locator**) as a
   page global, so an automation client can address it.
2. Show a short confirmation toast, like `Copied locator`.

A small content script runs in Chrome's isolated extension world in the top
frame. It only remembers the last right-clicked element in memory and renders
toasts in a closed shadow root. It sends no data anywhere and adds no page
globals. Website scripts cannot reach it or start Remote control.

### tabGroups

Groups Playwriter-connected tabs in a visible Chrome tab group so users can see
which tabs are attached. It also keeps popups opened by a controlled tab with the
source workflow.

### contextMenus

Adds the user-invoked **Copy Playwriter Locator** page menu action. The action
records a reference to the element that the user right-clicked so an automation
client can address it. The extension icon menu adds **Record skill**, **Share
browser…**, and, while sharing, **Stop sharing**.

### offscreen

Creates a hidden extension document to copy prompts to the clipboard and play
short menu sounds after user actions. Service workers cannot use the document
clipboard or Web Audio APIs directly.

### clipboardWrite

Copies prompts after trusted user actions such as **Share browser…**, **Record
skill**, or **Copy Playwriter Locator**. The website cannot request a clipboard write. The
offscreen document accepts only its allowlisted internal actions.

### storage

Stores a random local installation identifier used to distinguish multiple
Playwriter extensions connected to the same local relay. Session storage holds
the tunnel ID, the tab where sharing started, and the IDs of tabs the remote client
opened while Remote control is active so a service-worker restart does not break a
user-approved share. Revocation clears the session entry,
and browser shutdown clears session storage.

### identity and identity.email

Reads the Chrome profile account ID and email, when available, to distinguish
multiple Chrome profiles connected to the same local relay. These values are sent
only to the relay on the user's own computer. They are not included in the Remote
control handshake or sent through the Playwriter tunnel.

### webNavigation

Detects navigation and when a controlled tab opens a popup or new navigation
target. This lets Playwriter keep an OAuth or payment popup with the tab that
opened it.

### host_permissions (`<all_urls>`)

Required because users can choose to automate a tab on any website. Playwriter
does not attach to every existing tab. It attaches after the user clicks the
extension icon or a Playwriter menu item, or to new tabs opened by an authorized
automation client. The isolated content script runs on every site so the
right-click menu can copy a locator before the tab is attached.

### tabs in test builds

The build adds `tabs` only when `TESTING` is enabled. Production packages do not
request it. Tests use it to find tabs by URL and verify tab lifecycle behavior.

## Remote Code Justification

**Yes. Remote instructions execute only through the documented Debugger API.**

Playwriter receives CDP commands from the user's local Playwright client or from
a remote client that the user explicitly authorizes. Commands can include
`Runtime.evaluate` with code supplied by that client. Chrome Web Store Manifest
V3 policy expressly permits remote logic executed through the Debugger API when
used for that API's documented purpose.

All extension JavaScript, HTML, CSS, and WebAssembly are bundled in the submitted
package. The extension does not download remote script files, use `eval()` on
network responses, load remote configuration that changes extension behavior, or
run a separate command interpreter outside `chrome.debugger`.

The normal connection is `ws://localhost:19988/extension`. After a user confirms
Remote control, the extension also opens
`wss://playwriter.dev/tunnel/{id}/upstream` until the user stops sharing.

## Data Handling and Privacy

Playwriter handles browser data needed for its user-facing automation features.
Depending on the requested command, this can include:

- Website content, screenshots, and accessibility data
- URLs, navigation, network requests, and responses
- Clicks, typing, scrolling, and form interaction
- Console messages, source code, and debugging data
- Cookies, authentication information, and browser storage
- Screen and skill recordings explicitly started by the user

Normal automation sends this data only to the localhost relay on the user's
computer. Playwriter does not send local-mode browser payloads to its servers.

Users can separately expose their full local relay with `playwriter serve`, an
authentication token, and a network or tunnel configuration that they control.
In that mode, connected-tab data and local relay metadata can reach clients that
hold the token.

Remote control is disabled by default. It starts only after the user clicks
**Share browser…** in the extension icon menu and accepts a disclosure. The recipient receives the same broad
CDP access as a local client: every Playwriter-connected tab, plus new tabs it
opens. Browser data is
relayed over encrypted WebSockets through Playwriter's Cloudflare infrastructure
to anyone holding the bearer link. The current tunnel implementation routes
payloads in memory and does not persist them in Playwriter storage.

The initial viewer-page request omits the fragment containing the tunnel ID. The
viewer then uses that ID in the tunnel hostname, so Cloudflare and the tunnel
service process the hostname and connection metadata.

Playwriter does not use browser data for analytics, advertising, profiling,
credit decisions, or sale. The remote handshake sends the browser name and
Playwriter version, not the Chrome account email, account ID, or installation ID.

Privacy policy: https://playwriter.dev/privacy

## Chrome Web Store Listing Changes

These fields live in the Developer Dashboard and must be updated manually before
submitting the Remote control build.

### Purpose field

Use the **Single Purpose Description** from this document.

### Remote code field

Select **Yes**. Use the **Remote Code Justification** from this document. The
Debugger API exemption makes the behavior permitted, but it must still be
declared accurately.

### Data-use checkboxes

At minimum, disclose these categories:

- **Personally identifiable information**
- **Authentication information**
- **Web history**
- **User activity**
- **Website content**

Review the current Dashboard definitions before submission. Because a user can
share any authenticated tab, also select any more specific category that the
Dashboard says includes data visible in screenshots or page content.

Certify that data is not sold, is not used outside the extension's single
purpose, is not used for credit decisions, and complies with Limited Use.

### Privacy policy field

Set the URL to https://playwriter.dev/privacy.

### Store overview edits

Replace every unconditional **local only** claim. Use this text:

> **Local by default.** Normal automation connects the extension to a WebSocket
> relay on your own computer. Traffic leaves your computer only when you enable
> Remote control or configure full relay remote access.

Add this feature description:

> **Remote control.** Share your browser with a trusted agent through a
> temporary secret link. The agent can use every Playwriter-connected tab and
> open new tabs. Remote control is not a security sandbox. Traffic can include screenshots, page content, URLs, input events,
> network data, cookies, authentication data, and browser storage.
> Playwriter routes tunnel payloads in memory and does not store them. Anyone with
> the link has access until you click Stop sharing in the extension icon menu.

Replace the current **Permissions** list. It incorrectly names `activeTab`,
`tabs`, and `tabCapture`, which are not production manifest permissions. Use this shorter public
summary:

> **debugger:** Control tabs selected by the user through Chrome DevTools
> Protocol.
>
> **scripting:** Pin the right-clicked element and show short confirmation
> toasts after menu actions.
>
> **tabGroups, contextMenus:** Organize controlled tabs and add Playwriter
> actions to the page and extension icon menus.
>
> **offscreen, clipboardWrite:** Copy prompts to the clipboard and play menu
> sounds after explicit menu actions.
>
> **storage:** Keep a local installation ID and active Remote control session
> state.
>
> **identity, identity.email:** Distinguish Chrome profiles connected to the same
> local relay. These values are not sent through Remote control.
>
> **webNavigation:** Track navigation and popups opened by connected tabs.
>
> **host permissions:** Allow debugger attachment on any site the user chooses to
> automate.

Replace the current **Security and privacy** section with:

> **Local by default:** Normal browser automation stays between the extension and
> the relay on your computer. Traffic leaves only when you enable Remote control
> or configure full relay remote access.
>
> **Explicit remote consent:** Remote control is off by default. A confirmation
> explains what will be shared before the encrypted tunnel starts.
>
> **High-trust remote access:** A Remote control link gives the same access as a
> local automation client: every Playwriter-connected tab, plus new tabs. It is
> not a security sandbox, and the recipient must be fully trusted. A short
> denylist blocks whole-profile cookie APIs and cache clears.
>
> **Bearer-link security:** Anyone with the secret link receives broad browser
> automation access until you revoke it. Treat the link like a password.
>
> **No payload storage:** Remote tunnel frames are routed in memory and are not
> persisted by Playwriter. Cloudflare processes transport and connection metadata
> as the infrastructure provider.
>
> **No tracking:** Playwriter does not use browser data for analytics,
> advertising, profiling, or sale. Read https://playwriter.dev/privacy.

Delete or rewrite these current claims because they become false:

- `Everything runs locally on your machine.`
- `Nothing leaves your machine.`
- `No remote servers.`
- `Playwriter runs silently with no confirmation dialogs.`
- `The developer has disclosed that it will not collect or use your data.`

### Reviewer instructions

1. Install the extension and click its icon on a normal HTTPS tab.
2. Right-click the extension icon and click **Share browser…**.
3. Verify that a disclosure window appears, with a Read more link, before any tunnel starts.
4. Click **Share** and verify that the icon menu now shows **Stop sharing**.
5. Open the copied link in another browser and verify the tab viewer.
6. Right-click the extension icon, click **Stop sharing**, and verify that the link disconnects immediately.
7. Note that remote logic uses only the policy-exempt Debugger API and that no
   remote JavaScript bundle is loaded by the extension.

## Screenshots Required

Provide screenshots showing:

- The extension icon when disconnected and connected
- Chrome's debugger banner on a connected tab
- The Remote control disclosure before sharing starts
- The icon menu with **Stop sharing** while a share is active
- The browser viewer connected to the shared browser
