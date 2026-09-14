import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"

export type Opener = (target: string, options?: { app: { name: string } }) => Promise<ChildProcess>
export type Spawner = (
  command: string,
  args: readonly string[],
  options: { detached: boolean; stdio: "ignore" },
) => ChildProcess

export interface Options {
  readonly load: () => Promise<{
    readonly open: Opener
    readonly apps: { readonly chrome: string | readonly string[] }
  }>
  readonly platform?: NodeJS.Platform
  readonly env?: Record<string, string | undefined>
  readonly which?: (command: string) => string | null
  readonly exists?: (file: string) => boolean
  readonly spawn?: Spawner
  readonly home?: string
  readonly wsl?: () => boolean
  /** WSL drive mount point, as `open` reads it from /etc/wsl.conf. */
  readonly wslMount?: () => string
  /** How long to watch a launched process. Defaults to 1.5 s, or 5 s on Windows. */
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

export interface Result {
  readonly opened: boolean
  /** Every browser attempted, in order, with the failure of each one that did not open. */
  readonly tried: readonly { readonly browser: string; readonly error?: string }[]
}

interface Launch {
  readonly browser: string
  readonly start: () => Promise<void>
}

const wsl = () => {
  if (process.platform !== "linux") return false
  try {
    return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft")
  } catch {
    return false
  }
}

const wslMount = () => {
  try {
    const root = /^(?!\s*#)\s*root\s*=\s*(.*)$/m.exec(readFileSync("/etc/wsl.conf", "utf8"))?.[1]?.trim()
    if (!root) return "/mnt/"
    return root.endsWith("/") ? root : `${root}/`
  } catch {
    return "/mnt/"
  }
}

// The executor runs synchronously, so listeners are attached on the tick the child is obtained.
// An error or non-zero exit inside the window is a failed launch. A process still running after the
// window counts as opened, except on Windows where `Start` must report its exit code.
const watch = (child: ChildProcess, grace: number, running: "opened" | "failed") =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (running === "opened") return resolve()
      reject(new Error("browser did not report an exit code"))
    }, grace)
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

/**
 * True when a real launch must not happen: under a test runner (`bun test` sets NODE_ENV, every test
 * preload sets REDCODE_TEST_HOME) or with REDCODE_DESIGN_NO_OPEN. Only a test that injects its own
 * `spawn` gets past it, and that test's `load` supplies its own `open`.
 */
export const refused = (options: Pick<Options, "spawn">, env: Record<string, string | undefined> = process.env) =>
  options.spawn === undefined &&
  (env.NODE_ENV === "test" || env.REDCODE_TEST_HOME !== undefined || !!env.REDCODE_DESIGN_NO_OPEN)

/** Opens a Design review URL, preferring Chrome or Chromium. Never fails; reports whether and how it opened. */
export const open = (url: string, options: Options) =>
  Effect.gen(function* () {
    if (refused(options)) {
      yield* Effect.logDebug(
        "design review browser refused: no browser is launched under test or REDCODE_DESIGN_NO_OPEN",
      )
      return { opened: false, tried: [] } satisfies Result
    }
    const platform = options.platform ?? process.platform
    const env = options.env ?? process.env
    const which = options.which ?? Bun.which
    const exists = options.exists ?? existsSync
    const spawner = options.spawn ?? spawn
    const grace = options.grace ?? (platform === "win32" ? 5000 : 1500)
    const running = platform === "win32" ? "failed" : "opened"
    // `open` execs the app itself outside macOS and Windows; a missing executable would emit an
    // uncaught ENOENT before its promise settles, so those launches are resolved and spawned here.
    const direct = platform !== "darwin" && platform !== "win32"
    const inWsl = direct && (options.wsl ?? wsl)()
    const opener = yield* Effect.tryPromise(options.load)

    const spawned = (file: string): Launch => ({
      browser: file,
      start: () => {
        const child = spawner(file, [url], { detached: true, stdio: "ignore" })
        const watched = watch(child, grace, running)
        child.unref()
        return watched
      },
    })
    const opened = (app?: string): Launch => ({
      browser: app ?? "system default",
      start: () =>
        (app === undefined ? opener.open(url) : opener.open(url, { app: { name: app } })).then((child) =>
          watch(child, grace, running),
        ),
    })

    const configured = env.REDCODE_DESIGN_BROWSER?.trim()
    const preferred = yield* Effect.gen(function* () {
      if (configured === "default") return []
      if (configured && !direct) return [opened(configured)]
      if (configured) {
        const file = which(configured) ?? (exists(configured) ? configured : null)
        if (file) return [spawned(file)]
        yield* Effect.logDebug("design review browser not found", { browser: configured })
        return []
      }
      if (platform === "win32") return [opener.apps.chrome].flat().map((app) => opened(app))
      if (platform === "darwin") {
        // macOS paths are POSIX whatever the host, including tests that simulate darwin elsewhere.
        const home = options.home ?? os.homedir()
        return MAC_CANDIDATES.filter((item) =>
          [path.posix.join("/Applications", item.bundle), path.posix.join(home, "Applications", item.bundle)].some(
            exists,
          ),
        ).map((item) => opened(item.name))
      }
      if (inWsl) return []
      const files = LINUX_CANDIDATES.flatMap((name) => [which(name)].filter((file) => file !== null))
      return [...new Set(files)].map(spawned)
    })
    if (!configured && preferred.length === 0) yield* Effect.logDebug("design review found no Chrome or Chromium")

    // In WSL `open` execs Windows PowerShell through the drive mount; skip it when that path is missing
    // (a custom mount point) instead of letting the spawn emit an uncaught ENOENT.
    const powershell = inWsl
      ? `${(options.wslMount ?? wslMount)()}c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`
      : undefined
    if (powershell && !exists(powershell))
      yield* Effect.logDebug("design review found no Windows PowerShell under WSL", { powershell })
    const xdg = direct ? which("xdg-open") : null
    const system = [
      ...(!direct || (powershell && exists(powershell)) ? [opened()] : []),
      ...(xdg ? [spawned(xdg)] : []),
    ]

    const tried: { browser: string; error?: string }[] = []
    for (const launch of [...preferred, ...system]) {
      yield* Effect.logDebug("design review opening browser", { browser: launch.browser })
      const error = yield* Effect.tryPromise(launch.start).pipe(
        Effect.as(undefined),
        Effect.catch((failure) => Effect.succeed(String(failure.cause ?? failure))),
      )
      tried.push(error === undefined ? { browser: launch.browser } : { browser: launch.browser, error })
      if (error === undefined) return { opened: true, tried } satisfies Result
      yield* Effect.logDebug("design review could not launch browser", { browser: launch.browser, error })
    }
    return { opened: false, tried } satisfies Result
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logDebug("design review browser did not open", { cause }).pipe(
        Effect.as({ opened: false, tried: [] } satisfies Result),
      ),
    ),
  )

export * as DesignBrowserLauncher from "./browser-launcher"
