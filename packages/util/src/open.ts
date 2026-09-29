import { existsSync } from "node:fs"
import os from "node:os"
import { posix, win32 } from "node:path"
import open, { openApp } from "open"

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
  const url = httpUrl(input)
  if (url instanceof Error) return Promise.reject(url)
  if (browserDisabled(options.env)) return Promise.reject(new BrowserDisabledError(url.href))
  const browser = options.browser?.trim()
  if (!browser || browser === "default") return open(url.href)
  return open(url.href, { app: { name: browser } })
}

/**
 * Opens a Design review page in the browser `designLaunch` picks on this machine. A picked browser that
 * fails to start falls back to the system browser, so the review still opens somewhere.
 */
export function openDesignUrl(
  input: string,
  options: { readonly configured?: string | null; readonly env?: Record<string, string | undefined> } = {},
) {
  const url = httpUrl(input)
  if (url instanceof Error) return Promise.reject(url)
  const env = options.env ?? process.env
  if (browserDisabled(env)) return Promise.reject(new BrowserDisabledError(url.href))
  const launch = designLaunch(url.href, designBrowser(options.configured, env), {
    platform: process.platform,
    env,
    home: os.homedir(),
    exists: existsSync,
  })
  if (launch.kind === "system") return open(url.href)
  const started =
    launch.kind === "tab"
      ? open(url.href, { app: { name: launch.app } })
      : openApp(launch.app, { arguments: launch.arguments, newInstance: launch.newInstance })
  return started.catch(() => open(url.href))
}

/** How a Design review opens: the system browser, a tab in a chosen browser, or a Chromium app window. */
export type BrowserLaunch =
  | { readonly kind: "system" }
  | { readonly kind: "tab"; readonly app: string }
  | {
      readonly kind: "window"
      readonly app: string
      readonly arguments: readonly string[]
      /** macOS hands arguments only to a starting app, so the launch starts one that forwards them to Chrome. */
      readonly newInstance: boolean
    }

/** What `designLaunch` may look at. It only checks whether files exist, so choosing never starts a process. */
export type BrowserHost = {
  readonly platform: NodeJS.Platform
  readonly env: Record<string, string | undefined>
  readonly home: string
  readonly exists: (file: string) => boolean
}

const LINUX = {
  chrome: ["google-chrome", "google-chrome-stable", "google-chrome-beta", "google-chrome-unstable"],
  chromium: ["chromium", "chromium-browser"],
}

const MAC = {
  chrome: { bundle: "Google Chrome.app", app: "google chrome" },
  chromium: { bundle: "Chromium.app", app: "chromium" },
}

const WINDOWS = {
  chrome: ["Google", "Chrome", "Application", "chrome.exe"],
  chromium: ["Chromium", "Application", "chrome.exe"],
}

/**
 * Picks how a Design review opens. The review surface is validated in Chromium, so an unset preference uses
 * an installed Chrome, then Chromium, else the system browser (as the V1 launcher did). "chrome" and
 * "chromium" pick that family, "app" opens either as an app window (`--app=<url>`), "default" keeps the
 * system browser, and anything else is an app name or executable path. WSL keeps the Windows default browser.
 */
export function designLaunch(url: string, browser: string | undefined, host: BrowserHost): BrowserLaunch {
  const choice = browser?.toLowerCase()
  if (choice === "default") return { kind: "system" }
  if (browser !== undefined && choice !== "chrome" && choice !== "chromium" && choice !== "app")
    return { kind: "tab", app: browser }
  const families: readonly ("chrome" | "chromium")[] =
    choice === "chrome" || choice === "chromium" ? [choice] : ["chrome", "chromium"]
  const app = families.map((family) => installed(family, host)).find((found) => found !== undefined)
  if (!app) return { kind: "system" }
  if (choice !== "app") return { kind: "tab", app }
  return { kind: "window", app, arguments: [`--app=${url}`], newInstance: host.platform === "darwin" }
}

/** The app name or executable of an installed browser of the family, found without running anything. */
function installed(family: "chrome" | "chromium", host: BrowserHost) {
  if (host.platform === "darwin") {
    const mac = MAC[family]
    const bundles = [posix.join("/Applications", mac.bundle), posix.join(host.home, "Applications", mac.bundle)]
    return bundles.some(host.exists) ? mac.app : undefined
  }
  if (host.platform === "win32")
    return [host.env.ProgramFiles, host.env["ProgramFiles(x86)"], host.env.LOCALAPPDATA]
      .filter((root): root is string => !!root)
      .map((root) => win32.join(root, ...WINDOWS[family]))
      .find(host.exists)
  if (host.env.WSL_DISTRO_NAME) return undefined
  const directories = (host.env.PATH ?? "").split(":").filter(Boolean)
  return LINUX[family]
    .flatMap((name) => directories.map((directory) => posix.join(directory, name)))
    .find(host.exists)
}

export function openPath(path: string, options: Pick<OpenOptions, "env"> = {}) {
  if (browserDisabled(options.env)) return Promise.reject(new BrowserDisabledError(path))
  return open(path)
}

function httpUrl(input: string) {
  const url = URL.canParse(input) ? new URL(input) : undefined
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:"))
    return new Error(`Only http and https links can be opened in the browser: ${input}`)
  return url
}
