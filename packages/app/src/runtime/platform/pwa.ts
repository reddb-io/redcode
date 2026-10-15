import { useLocation } from "@solidjs/router"
import { createEffect } from "solid-js"
import { createStore } from "solid-js/store"

type InstallPrompt = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export function createPwaInstallation() {
  const [state, setState] = createStore({
    prompt: undefined as InstallPrompt | undefined,
    installed: isStandalone(),
    pending: false,
    failed: false,
  })

  // Capture the browser's one-use prompt before the user opens Settings.
  // This controller lives for the web entrypoint's lifetime.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault()
    setState({ prompt: event as InstallPrompt, failed: false })
  })
  window.addEventListener("appinstalled", () => setState({ installed: true, prompt: undefined }))

  return {
    status: () => {
      if (state.installed) return "installed" as const
      if (!window.isSecureContext) return "insecure" as const
      return state.prompt ? ("available" as const) : ("manual" as const)
    },
    pending: () => state.pending,
    failed: () => state.failed,
    async install() {
      const prompt = state.prompt
      if (!prompt || state.pending) return
      setState({ prompt: undefined, pending: true, failed: false })
      await prompt
        .prompt()
        .then(() => prompt.userChoice)
        .catch(() => setState("failed", true))
        .finally(() => setState("pending", false))
    },
  }
}

const LAST_ROUTE_KEY = "opencode.pwa.last-route"

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  )
}

export function restorePwaRoute() {
  if (location.pathname !== "/" || location.search || location.hash) return

  try {
    const value = localStorage.getItem(LAST_ROUTE_KEY)

    if (!value) return
    const url = new URL(value, location.origin)

    if (url.origin !== location.origin || url.searchParams.has("auth_token")) return

    if (
      url.pathname !== "/" &&
      url.pathname !== "/new-session" &&
      !/^\/server\/[^/]+\/session\/[^/]+$/.test(url.pathname)
    )
      return
    history.replaceState(history.state, "", url.pathname + url.search + url.hash)
  } catch {
    // Storage may be unavailable; keep the launch URL in that case.
  }
}

export function PwaRoutePersistence() {
  const location = useLocation()
  createEffect(() => {
    const value = location.pathname + location.search + location.hash

    try {
      localStorage.setItem(LAST_ROUTE_KEY, value)
    } catch {
      // Navigation must still work when storage is unavailable or full.
    }
  })

  return null
}
