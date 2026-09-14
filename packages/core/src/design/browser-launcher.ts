import { Effect } from "effect"

export type AppName = string | readonly string[]
export type Opener = (target: string, options?: { app: { name: AppName } }) => Promise<unknown>

export interface Options {
  readonly load: () => Promise<{ readonly open: Opener; readonly apps: { readonly chrome: AppName } }>
  readonly platform?: NodeJS.Platform
  readonly env?: Record<string, string | undefined>
  readonly which?: (command: string) => string | null
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

const chrome = (platform: NodeJS.Platform, which: (command: string) => string | null, apps: { chrome: AppName }) => {
  if (platform === "linux") return LINUX_CANDIDATES.find((name) => which(name) !== null)
  if (platform === "darwin") return [...[apps.chrome].flat(), "chromium"]
  if (platform === "win32") return apps.chrome
  return undefined
}

/** Opens a Design review URL, preferring Chrome or Chromium. Never fails; succeeds with whether a browser opened. */
export const open = (url: string, options: Options) =>
  Effect.gen(function* () {
    const env = options.env ?? process.env
    const opener = yield* Effect.tryPromise(options.load)
    const launch = (app?: AppName) =>
      Effect.tryPromise(() => (app === undefined ? opener.open(url) : opener.open(url, { app: { name: app } })))
    const system = Effect.logDebug("design review opening in the system default browser").pipe(Effect.andThen(launch()))

    const configured = env.REDCODE_DESIGN_BROWSER?.trim()
    if (configured === "default") return yield* system
    if (configured) {
      yield* Effect.logDebug("design review opening in the configured browser", { browser: configured })
      return yield* launch(configured)
    }

    const app = chrome(options.platform ?? process.platform, options.which ?? Bun.which, opener.apps)
    if (app === undefined) {
      yield* Effect.logDebug("design review found no Chrome or Chromium")
      return yield* system
    }
    yield* Effect.logDebug("design review opening in Chrome or Chromium", { browser: app })
    return yield* launch(app).pipe(
      Effect.catch((error) =>
        Effect.logDebug("design review could not launch Chrome or Chromium", { browser: app, error }).pipe(
          Effect.andThen(system),
        ),
      ),
    )
  }).pipe(
    Effect.as(true),
    Effect.catchCause((cause) =>
      Effect.logDebug("design review browser did not open", { cause }).pipe(Effect.as(false)),
    ),
  )

export * as DesignBrowserLauncher from "./browser-launcher"
