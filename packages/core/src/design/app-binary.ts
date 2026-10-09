export * as DesignAppBinary from "./app-binary.js"

import path from "node:path"
import { existsSync, realpathSync } from "node:fs"

/**
 * Where the design app (`redcode-design`) comes from. It ships in the same `vX.Y.Z` release as redcode:
 * next to the binary in a release archive (and mise), and as the `@reddb-io/redcode-design-<target>`
 * package that npm installs beside redcode's own platform package.
 */

declare const REDCODE_DESIGN_APP_VERSION: string | undefined
declare const REDCODE_TARGET: string | undefined

/** The app release this redcode build shipped with; a running app older than it is replaced. */
export const MINIMUM = typeof REDCODE_DESIGN_APP_VERSION === "string" ? REDCODE_DESIGN_APP_VERSION : undefined

/**
 * Where a start of the design app stands, shared by the whole process: a review link opened meanwhile
 * shows it on a waiting page.
 */
export interface Progress {
  readonly phase: "start"
  readonly started: number
}

const tracker = { current: undefined as Progress | undefined, listeners: new Set<(progress?: Progress) => void>() }

/** The start in progress in this process, if any. */
export function progress() {
  return tracker.current
}

/** Calls the listener on every progress change, and with nothing once the app runs or failed to. */
export function watch(listener: (progress?: Progress) => void) {
  tracker.listeners.add(listener)
  return () => {
    tracker.listeners.delete(listener)
  }
}

export function report(next?: Progress) {
  tracker.current = next
  tracker.listeners.forEach((listener) => listener(next))
}

export interface Options {
  readonly env?: Record<string, string | undefined>
  /** The design app's entry in a source checkout, run with Bun; false when there is none. */
  readonly source?: string | false
  /** The running redcode binary, whose installation carries the design app. Default: this process. */
  readonly executable?: string
  /** Release platform, as redcode's build names it: linux-x64, darwin-arm64, windows-x64-baseline… */
  readonly target?: string
}

/**
 * How to start the design app, first match wins: `REDCODE_DESIGN_BIN`, the source of this checkout
 * run with Bun, or the app shipped in this redcode's own installation.
 */
export function command(options: Options = {}) {
  const bin = (options.env ?? process.env).REDCODE_DESIGN_BIN?.trim()
  if (bin) return [bin]
  const source = options.source ?? checkout()
  if (source) return [process.execPath, source]
  const executable = options.executable ?? process.execPath
  const platform = options.target ?? target()
  const bundled = sibling(executable, platform)
  if (bundled) return [bundled]
  throw new Error(
    `The design app is missing from this redcode installation; looked for ${candidates(executable, platform).join(" and ")}. Reinstall redcode, or set REDCODE_DESIGN_BIN to a redcode-design binary.`,
  )
}

/**
 * The design app installed beside a compiled redcode: next to it in a release archive (and mise), or
 * in the sibling `@reddb-io/redcode-design-<target>` package of an npm install, where redcode lives
 * at `@reddb-io/redcode-<target>/bin/redcode`.
 */
export function sibling(executable: string, platform: string) {
  return candidates(executable, platform).find((candidate) => existsSync(candidate))
}

function candidates(executable: string, platform: string) {
  const name = platform.startsWith("windows") ? "redcode-design.exe" : "redcode-design"
  const real = existsSync(executable) ? realpathSync(executable) : executable
  return [
    path.join(path.dirname(real), name),
    path.join(path.dirname(path.dirname(path.dirname(real))), `redcode-design-${platform}`, "bin", name),
  ]
}

/** The app's source when redcode itself runs from a checkout with Bun; never in a compiled redcode. */
export function checkout() {
  const entry = path.resolve(import.meta.dir, "../../../design-app/src/index.ts")
  if (!existsSync(entry)) return false
  if (path.basename(process.execPath).replace(/\.exe$/, "") !== "bun") return false
  return entry
}

/** The platform of this redcode's own build, so the app matches its libc and CPU baseline. */
export function target() {
  if (typeof REDCODE_TARGET === "string") return REDCODE_TARGET
  return `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
}
