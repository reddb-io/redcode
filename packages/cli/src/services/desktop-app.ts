export * as DesktopApp from "./desktop-app"

import { spawn } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"

/**
 * Where Redcode Desktop comes from. It ships in the same `vX.Y.Z` release as redcode: unpacked in a `desktop/` folder
 * next to the binary in a release archive (and mise), and as the `@reddb-io/redcode-desktop-<os>-<arch>` package that
 * npm installs beside redcode's own platform package, holding one `desktop/desktop.tar` that the first
 * `redcode desktop` extracts into the cache. There is none for musl.
 */

declare const REDCODE_TARGET: string | undefined

export interface Options {
  readonly env: Readonly<Record<string, string | undefined>>
  /** Release platform, as redcode's build names it: linux-x64, linux-x64-baseline-musl, windows-arm64… */
  readonly target: string
  /** The real path of the running redcode binary, whose installation carries the app. */
  readonly executable: string
  /** Redcode's cache directory, where an npm install's app is extracted per version. */
  readonly cache: string
  readonly version: string
  /** packages/desktop of the checkout redcode runs from with Bun; false in a compiled redcode. */
  readonly source: string | false
}

export interface Located {
  readonly source: "environment" | "archive" | "npm"
  /** The app the desktop knows itself as: the bundle on macOS, the executable elsewhere. */
  readonly app: string
  /** What starts it. */
  readonly executable: string
  /** The folder this installation unpacked the app into, which preparing it never reaches outside of. */
  readonly root?: string
}

/**
 * The desktop app of this redcode, first match wins: `REDCODE_DESKTOP_APP`, the `desktop/` folder beside redcode in an
 * archive, or the npm package beside redcode's own, extracted once per version.
 */
export async function locate(options: Options): Promise<Located> {
  const platform = parse(options.target)
  const override = options.env.REDCODE_DESKTOP_APP?.trim()
  if (override) return { source: "environment", app: override, executable: executable(platform.os, override) }
  if (!platform.desktop) throw new Error(`Redcode Desktop is not available for ${options.target}`)
  const name = appName(platform.os)
  const folder = path.join(path.dirname(options.executable), "desktop")
  const archived = path.join(folder, name)
  if (existsSync(archived))
    return { source: "archive", app: archived, executable: executable(platform.os, archived), root: folder }
  const tar = path.join(
    path.dirname(path.dirname(path.dirname(options.executable))),
    `redcode-desktop-${platform.desktop}`,
    "desktop",
    "desktop.tar",
  )
  if (existsSync(tar)) {
    const root = path.join(options.cache, "desktop", options.version)
    const app = path.join(root, name)
    if (!existsSync(app)) await extract(tar, root)
    return { source: "npm", app, executable: executable(platform.os, app), root }
  }
  if (options.source)
    throw new Error(`Redcode Desktop is not built in this checkout. Run it from source: cd ${options.source} && bun run dev`)
  throw new Error(
    `Redcode Desktop is missing from this redcode installation; looked for ${archived} and ${tar}. Reinstall redcode, or set REDCODE_DESKTOP_APP to the app.`,
  )
}

/**
 * The commands that let an app this installation unpacked run as the OS would run an installed one: the Chromium
 * sandbox's AppContainer needs read and execute access on Windows (an installer used to grant it), and files from a
 * browser download carry Mark-of-the-Web on Windows and quarantine on macOS. None reaches outside the app's folder.
 */
export function preparation(located: Located, target: string, env: Readonly<Record<string, string | undefined>>) {
  if (!located.root) return []
  const os = parse(target).os
  const system = path.win32.join(env.SystemRoot ?? "C:\\Windows", "System32")
  if (os === "windows")
    return [
      [path.win32.join(system, "icacls.exe"), located.root, "/grant", "*S-1-15-2-2:(OI)(CI)(RX)", "/Q"],
      [
        path.win32.join(system, "WindowsPowerShell", "v1.0", "powershell.exe"),
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-ChildItem -LiteralPath '${located.root.replaceAll("'", "''")}' -Recurse -File | Unblock-File`,
      ],
    ]
  if (os === "darwin") return [["xattr", "-dr", "com.apple.quarantine", located.app]]
  return []
}

/**
 * Electron's setuid sandbox helper on Linux, and the commands that make it usable when it is not root-owned with
 * mode 4755. Unpacking the app as a user loses both, so every upgrade asks again.
 */
export function sandbox(located: Located, target: string, stat?: { readonly uid: number; readonly mode: number }) {
  if (!located.root || parse(target).os !== "linux" || !stat) return undefined
  if (stat.uid === 0 && (stat.mode & 0o7777) === 0o4755) return undefined
  const helper = path.join(path.dirname(located.executable), "chrome-sandbox")
  return {
    helper,
    commands: [
      ["sudo", "chown", "root:root", helper],
      ["sudo", "chmod", "4755", helper],
    ],
  }
}

/** Where `redcode desktop` tells the app which installation it belongs to (the desktop reads the same file). */
export function pointer(state: string) {
  return path.join(state, "desktop.json")
}

/** The pointer's contents: the installation's CLI, and the app as the desktop knows itself (see Located.app). */
export function record(input: { readonly version: string; readonly cli: string; readonly app: string }) {
  return JSON.stringify({ version: input.version, cli: input.cli, app: input.app }, null, 2)
}

/** Starts the app on its own, with the CLI it should run, and returns once it is running. */
export async function launch(located: Located, cli?: string) {
  const child = spawn(located.executable, [], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...(cli ? { REDCODE_DESKTOP_CLI: cli } : {}) },
  })
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
  child.unref()
}

/** Runs a command with the terminal attached and returns its exit code. */
export function run(command: string[], stdio: "inherit" | "ignore" = "inherit") {
  return Bun.spawn(command, { stdin: stdio, stdout: stdio, stderr: stdio }).exited
}

/** The platform of this redcode's own build. */
export function target() {
  if (typeof REDCODE_TARGET === "string") return REDCODE_TARGET
  return `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
}

/** packages/desktop when redcode itself runs from a checkout with Bun; never in a compiled redcode. */
export function checkout() {
  const source = path.resolve(import.meta.dir, "../../../desktop")
  if (!existsSync(path.join(source, "package.json"))) return false
  if (path.basename(process.execPath).replace(/\.exe$/, "") !== "bun") return false
  return source
}

/** The running redcode binary, when it is one: a checkout runs Bun instead, which the app cannot use as its CLI. */
export function cli() {
  if (path.basename(process.execPath).replace(/\.exe$/, "") === "bun") return undefined
  return realpathSync(process.execPath)
}

// The desktop target a CLI target runs: baseline builds share their os/arch app, and musl has none.
function parse(target: string) {
  const [os = "", arch = ""] = target.split("-")
  const supported = ["linux", "darwin", "windows"].includes(os) && ["x64", "arm64"].includes(arch)
  return { os, desktop: supported && !target.endsWith("-musl") ? `${os}-${arch}` : undefined }
}

// The production app's names, as electron-builder lays it out: linux.executableName is the app id.
function appName(os: string) {
  if (os === "windows") return "Redcode.exe"
  if (os === "darwin") return "Redcode.app"
  return "io.reddb.redcode"
}

// A macOS bundle starts through its own binary, so the app receives this process's environment.
function executable(os: string, app: string) {
  if (os !== "darwin" || !app.endsWith(".app")) return app
  return path.join(app, "Contents", "MacOS", path.basename(app, ".app"))
}

// Extracts beside the destination and renames it into place, so a concurrent or interrupted extraction never leaves
// a partial app where the next run would start it.
async function extract(tar: string, destination: string) {
  const temp = `${destination}.${process.pid}.tmp`
  await rm(temp, { recursive: true, force: true })
  await rm(destination, { recursive: true, force: true })
  await mkdir(temp, { recursive: true })
  // Windows' own tar is bsdtar, which reads drive letters; a GNU tar earlier on PATH reads `C:` as a remote host.
  const command =
    process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
  const child = Bun.spawn([command, "-xf", tar], { cwd: temp, stdout: "ignore", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) {
    await rm(temp, { recursive: true, force: true })
    throw new Error(`Failed to extract Redcode Desktop from ${tar}: ${stderr.trim()}`)
  }
  await rename(temp, destination).catch(async (error) => {
    await rm(temp, { recursive: true, force: true })
    // Another redcode desktop extracted the same version first.
    if (!existsSync(destination)) throw error
  })
}
