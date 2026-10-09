export * as ShellIntegration from "./shell-integration"

import { execFile } from "node:child_process"
import { copyFileSync, lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { App, Shell } from "electron"
import { Effect, Option, Schema } from "effect"
import { SHELL_INTEGRATION_KEY } from "../storage/keys"
import type { SettingsStore } from "../storage/store"

/** The running app's identity and the Electron modules it registers through, passed in by its caller. */
export interface Input {
  readonly app: App
  readonly shell: Shell
  readonly store: SettingsStore
  readonly appId: string
  readonly name: string
  readonly scheme: string
}

/**
 * The Redcode release ships the app unpacked, with no installer, so a packaged app registers its own launcher on
 * first launch, and again whenever it runs from another path or version (an upgrade, or another installation):
 *
 * - Linux: a `.desktop` file (which also handles `redcode://` links) and its hicolor icon;
 * - Windows: a Start Menu shortcut carrying the app's AppUserModelID;
 * - macOS: a `~/Applications` link to the app bundle, registered with Launch Services.
 *
 * Runs before `app.setAsDefaultProtocolClient`, which on Linux names the `.desktop` file written here.
 */
export const register = Effect.fn("ShellIntegration.register")(
  function* (input: Input) {
    const current = { app: self(), version: input.app.getVersion() }

    if (!stale(input.store.get(SHELL_INTEGRATION_KEY), current)) return
    yield* Effect.try(() => {
      if (process.platform === "linux") return linux(input, current.app)
      if (process.platform === "win32") return windows(input, current.app)
      if (process.platform === "darwin") return darwin(input, current.app)
    })
    input.store.set(SHELL_INTEGRATION_KEY, current)
    yield* Effect.logInfo("shell integration registered", current)
  },
  Effect.catch((error) => Effect.logWarning("failed to register shell integration", { error })),
)

/** Whether the stored registration names another app path or version than the running one. */
export function stale(stored: unknown, current: typeof Registration.Type) {
  const previous = Option.getOrUndefined(Schema.decodeUnknownOption(Registration)(stored))

  return previous?.app !== current.app || previous.version !== current.version
}

/** The launcher of the Linux app at `executable`, which also opens `redcode://` links. */
export function desktopEntry(input: {
  readonly appId: string
  readonly name: string
  readonly scheme: string
  readonly executable: string
}) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${input.name}`,
    `Exec=${execArgument(input.executable)} %U`,
    `Icon=${input.appId}`,
    "Terminal=false",
    "Categories=Development;",
    `MimeType=x-scheme-handler/${input.scheme};`,
    // Desktop shells match the running window to this launcher by its WM class, which follows the executable name:
    // electron-builder names the Linux executable after the app id.
    `StartupWMClass=${input.appId}`,
    "",
  ].join("\n")
}

const Registration = Schema.Struct({ app: Schema.String, version: Schema.String })

// The macOS app is its bundle; elsewhere the executable is the app.
function self() {
  return process.platform === "darwin" ? path.resolve(process.execPath, "../../..") : process.execPath
}

function linux(input: Input, executable: string) {
  const data = process.env.XDG_DATA_HOME || path.join(input.app.getPath("home"), ".local", "share")
  const applications = path.join(data, "applications")
  const icons = path.join(data, "icons", "hicolor", "512x512", "apps")
  mkdirSync(applications, { recursive: true })
  mkdirSync(icons, { recursive: true })
  copyFileSync(path.join(process.resourcesPath, "icons", "icon-512.png"), path.join(icons, `${input.appId}.png`))
  writeFileSync(
    path.join(applications, `${input.appId}.desktop`),
    desktopEntry({ appId: input.appId, name: input.name, scheme: input.scheme, executable }),
  )
  attempt("xdg-mime", ["default", `${input.appId}.desktop`, `x-scheme-handler/${input.scheme}`])
  attempt("update-desktop-database", [applications])
}

// The `redcode://` handler is the HKCU entry app.setAsDefaultProtocolClient writes.
function windows(input: Input, executable: string) {
  const programs = path.join(input.app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs")
  const shortcut = path.join(programs, `${input.name}.lnk`)
  mkdirSync(programs, { recursive: true })

  if (!input.shell.writeShortcutLink(shortcut, { target: executable, appUserModelId: input.appId }))
    throw new Error(`Failed to write the Start Menu shortcut ${shortcut}`)
}

// A real app the user put in ~/Applications is left alone; only a link this app made is replaced.
function darwin(input: Input, bundle: string) {
  const applications = path.join(input.app.getPath("home"), "Applications")
  const link = path.join(applications, `${input.name}.app`)
  const existing = lstatSync(link, { throwIfNoEntry: false })
  mkdirSync(applications, { recursive: true })

  if (existing && !existing.isSymbolicLink()) return
  if (existing) rmSync(link)
  symlinkSync(bundle, link)
  attempt("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", [
    "-f",
    bundle,
  ])
}

// Desktop database refreshes are best-effort: a desktop without these tools still finds the launcher on its next scan.
function attempt(command: string, args: string[]) {
  execFile(command, args, () => {})
}

// The Exec key quotes its argument, escaping ", `, $ and \, and then the string value escapes every \ again.
// A literal % is %%. https://specifications.freedesktop.org/desktop-entry-spec/latest/exec-variables.html
function execArgument(executable: string) {
  return `"${executable.replace(/["`$\\]/g, (character) => `\\${character}`)}"`
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "%%")
}
