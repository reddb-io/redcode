import { NoBrowser } from "@reddb-io/redcode-core/util/no-browser"

/** Launches `url` in a browser on the machine running the TUI; rejects when no browser could be started. */
export type BrowserOpener = (url: string) => Promise<void>

export type BrowserOpenResult = { opened: true } | { opened: false; reason: string }

// `open` resolves once the launcher process spawns; a missing browser (SSH, headless) shows up as an
// early non-zero exit, so watch the process briefly before calling it a success.
const LAUNCH_GRACE_MS = 500

const systemOpener: BrowserOpener = async (url) => {
  const { default: open } = await import("open")
  const child = await open(url)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, LAUNCH_GRACE_MS)
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("exit", (code) => {
      if (code === null || code === 0) return
      clearTimeout(timer)
      reject(new Error(`browser launcher exited with code ${code}`))
    })
  })
}

/**
 * Open `url` for an automatic flow (not a link the user clicked). The system opener honours
 * `REDCODE_NO_BROWSER`; an injected opener (tests) is always called.
 */
export async function openBrowser(url: string, opener?: BrowserOpener): Promise<BrowserOpenResult> {
  if (!opener) {
    const blocked = NoBrowser.blockedBy()
    if (blocked) return { opened: false, reason: `${blocked} is set` }
  }
  try {
    await (opener ?? systemOpener)(url)
    return { opened: true }
  } catch (error) {
    return { opened: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export * as Browser from "./browser"
