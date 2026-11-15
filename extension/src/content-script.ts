// Content script in Chrome's ISOLATED world, top frame of every page. It must be
// a plain script (manifest content_scripts cannot be ES modules): no imports.
//
// - Remembers the last right-clicked element, so the context menu can copy a
//   locator on tabs that Playwriter has not attached yet. The page cannot see
//   these globals: isolated-world window properties are private to the extension.
// - Shows short toasts for context menu and icon menu actions.
//
// The service worker reads these via chrome.scripting.executeScript({ world: 'ISOLATED' }),
// which runs in this same isolated world.

declare global {
  interface Window {
    __playwriterContentScript?: boolean
    __playwriterContextTarget?: Element | null
    __playwriterShowToast?: (message: string) => void
    // MAIN world: pin counter and pinned element globals (playwriterPinnedElem1, ...)
    __playwriterPinCount?: number
    [key: `playwriterPinnedElem${number}`]: Element | undefined
  }
}

function installPlaywriterContentScript(): void {
  if (window.__playwriterContentScript) {
    return
  }
  window.__playwriterContentScript = true
  window.__playwriterContextTarget = null

  document.addEventListener(
    'contextmenu',
    (e) => {
      // composedPath()[0] is the real target inside open shadow roots.
      const target = e.composedPath()[0]
      window.__playwriterContextTarget = target instanceof Element ? target : null
    },
    true,
  )

  let toastTimer: number | undefined
  let toastHost: HTMLDivElement | null = null

  window.__playwriterShowToast = (message: string) => {
    toastHost?.remove()
    window.clearTimeout(toastTimer)

    const host = document.createElement('div')
    host.style.cssText =
      'all:initial;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;'
    const shadow = host.attachShadow({ mode: 'closed' })
    const toast = document.createElement('div')
    toast.textContent = message
    toast.style.cssText = [
      'background:#393B44',
      'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:9999px',
      'padding:6px 14px',
      'color:#e4e4e7',
      'font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'box-shadow:0 12px 60px rgba(0,0,0,0.6),0 4px 20px rgba(0,0,0,0.4)',
      'white-space:nowrap',
    ].join(';')
    toast.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
    shadow.appendChild(toast)
    document.documentElement.appendChild(host)
    toastHost = host
    toastTimer = window.setTimeout(() => {
      host.remove()
    }, 1900)
  }
}

installPlaywriterContentScript()

export {}
