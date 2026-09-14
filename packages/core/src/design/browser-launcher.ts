import type { ChildProcess } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"

export type Opener = (target: string, options?: { app: { name: string } }) => Promise<ChildProcess>

export interface Options {
  readonly load: () => Promise<{
    readonly open: Opener
    readonly apps: { readonly chrome: string | readonly string[] }
  }>
  readonly platform?: NodeJS.Platform
  readonly env?: Record<string, string | undefined>
  readonly which?: (command: string) => string | null
  readonly exists?: (file: string) => boolean
  readonly home?: string
  readonly wsl?: () => boolean
  /** How long a launched process must survive (or exit 0 within) to count as opened. */
  readonly grace?: number
}

// Firefox is a common system default; the review surface is validated in Chromium.
const LINUX_CANDIDATES = [
  "google-chrome",
  "google-chrome-stable",
  "google-chrome-beta",
  "google-chrome-unstable",
  "chromium",
  "chromium-browser",
]

const MAC_CANDIDATES = [
  { bundle: "Google Chrome.app", name: "google chrome" },
  { bundle: "Chromium.app", name: "chromium" },
]

const wsl = () => {
  if (process.platform !== "linux") return false
  try {
    return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft")
  } catch {
    return false
  }
}

const chrome = (options: Options, apps: { chrome: string | readonly string[] }) => {
  const platform = options.platform ?? process.platform
  if (platform === "linux") {
    if ((options.wsl ?? wsl)()) return []
    const which = options.which ?? Bun.which
    return [...new Set(LINUX_CANDIDATES.flatMap((name) => [which(name)].filter((file) => file !== null)))]
  }
  if (platform === "darwin") {
    const exists = options.exists ?? existsSync
    const home = options.home ?? os.homedir()
    return MAC_CANDIDATES.filter((item) =>
      [path.join("/Applications", item.bundle), path.join(home, "Applications", item.bundle)].some(exists),
    ).map((item) => item.name)
  }
  if (platform === "win32") return [apps.chrome].flat()
  return []
}

// `open` returns as soon as the process is spawned and never listens for its failure, so a missing
// app would surface later as an uncaught `error`. Watch it until it exits or survives the grace window.
const watch = (child: ChildProcess, grace: number) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, grace)
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      if (code === 0) return resolve()
      reject(new Error(`browser exited with ${code === null ? `signal ${signal}` : `code ${code}`}`))
    })
  })

/** Opens a Design review URL, preferring Chrome or Chromium. Never fails; succeeds with whether a browser opened. */
export const open = (url: string, options: Options) =>
  Effect.gen(function* () {
    const env = options.env ?? process.env
    const grace = options.grace ?? 1500
    const opener = yield* Effect.tryPromise(options.load)
    const configured = env.REDCODE_DESIGN_BROWSER?.trim()
    const preferred = configured === "default" ? [] : configured ? [configured] : chrome(options, opener.apps)
    if (!configured && preferred.length === 0) yield* Effect.logDebug("design review found no Chrome or Chromium")

    for (const app of [...preferred, undefined]) {
      const browser = app ?? "system default"
      yield* Effect.logDebug("design review opening browser", { browser })
      const opened = yield* Effect.tryPromise(() =>
        (app === undefined ? opener.open(url) : opener.open(url, { app: { name: app } })).then((child) =>
          watch(child, grace),
        ),
      ).pipe(
        Effect.as(true),
        Effect.catch((error) =>
          Effect.logDebug("design review could not launch browser", { browser, error }).pipe(Effect.as(false)),
        ),
      )
      if (opened) return true
    }
    return false
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logDebug("design review browser did not open", { cause }).pipe(Effect.as(false)),
    ),
  )

export * as DesignBrowserLauncher from "./browser-launcher"
