import open from "open"

/** Forbids every browser and system-opener launch from this process. Test preloads set it. */
export const NO_BROWSER = "REDCODE_NO_BROWSER"

/**
 * Rejection used instead of launching while `REDCODE_NO_BROWSER` is set. Its message carries the
 * target, so callers that surface the error show the link the user has to open themselves.
 */
export class BrowserDisabledError extends Error {
  readonly target: string

  constructor(target: string) {
    super(`Browser launch is disabled by ${NO_BROWSER}. Open it manually: ${target}`)
    this.name = "BrowserDisabledError"
    this.target = target
  }
}

export type OpenOptions = {
  /** Browser app name or executable path; empty or "default" uses the system browser. */
  readonly browser?: string
  readonly env?: Record<string, string | undefined>
}

/** Whether `REDCODE_NO_BROWSER` forbids launching. Unset, empty, "0", "false", "no" and "off" allow it. */
export function browserDisabled(env: Record<string, string | undefined> = process.env) {
  const value = env[NO_BROWSER]?.trim().toLowerCase()
  return !!value && !["0", "false", "no", "off"].includes(value)
}

/** The browser for Design review pages: `REDCODE_DESIGN_BROWSER` wins over the `design.browser` setting. */
export function designBrowser(configured?: string | null, env: Record<string, string | undefined> = process.env) {
  return env.REDCODE_DESIGN_BROWSER?.trim() || configured?.trim() || undefined
}

export function openUrl(input: string, options: OpenOptions = {}) {
  const url = URL.canParse(input) ? new URL(input) : undefined
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:"))
    return Promise.reject(new Error(`Only http and https links can be opened in the browser: ${input}`))
  if (browserDisabled(options.env)) return Promise.reject(new BrowserDisabledError(url.href))
  const browser = options.browser?.trim()
  if (!browser || browser === "default") return open(url.href)
  return open(url.href, { app: { name: browser } })
}

export function openPath(path: string, options: Pick<OpenOptions, "env"> = {}) {
  if (browserDisabled(options.env)) return Promise.reject(new BrowserDisabledError(path))
  return open(path)
}
