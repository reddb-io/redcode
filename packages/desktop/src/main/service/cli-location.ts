import path from "node:path"
import { Option, Schema } from "effect"

export type CliLocation =
  | { readonly source: "environment" | "archive" | "pointer"; readonly binary: string; readonly version: string }
  | { readonly source: "development"; readonly binary: string }

/**
 * Finds the `redcode` executable of the installation this app ships in. The desktop and its CLI share one
 * version, so an installation's CLI needs no `--version` spawn; a development CLI still does.
 */
export function locateCli(input: {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly platform: NodeJS.Platform
  readonly resourcesPath: string
  readonly execPath: string
  /** The app's own version. */
  readonly version: string
  /** The `desktop.json` pointer written by `redcode desktop`. */
  readonly pointer: string
  readonly exists: (file: string) => boolean
  readonly read: (file: string) => string | undefined
}): CliLocation {
  const paths = input.platform === "win32" ? path.win32 : path.posix
  const executable = input.platform === "win32" ? "redcode.exe" : "redcode"

  // Set by `redcode desktop` when it launches the app.
  if (input.env.REDCODE_DESKTOP_CLI)
    return { source: "environment", binary: input.env.REDCODE_DESKTOP_CLI, version: input.version }

  // Archives unpack the app into a `desktop` folder beside the CLI: `<root>/desktop/resources` on Linux and
  // Windows, `<root>/desktop/Redcode.app/Contents/Resources` on macOS.
  const folder =
    input.platform === "darwin" ? paths.resolve(input.resourcesPath, "../../..") : paths.dirname(input.resourcesPath)
  const sibling = paths.join(paths.dirname(folder), executable)

  if (paths.basename(folder) === "desktop" && input.exists(sibling))
    return { source: "archive", binary: sibling, version: input.version }

  // An app away from its CLI, such as one REDCODE_DESKTOP_APP names, finds it through the pointer `redcode desktop`
  // left. A pointer left by another installation names a different app and is ignored.
  const pointer = Option.getOrUndefined(decodePointer(input.read(input.pointer)))
  const self = input.platform === "darwin" ? paths.resolve(input.resourcesPath, "../..") : input.execPath
  const key = (file: string) => (input.platform === "win32" ? paths.resolve(file).toLowerCase() : paths.resolve(file))

  if (pointer && key(pointer.app) === key(self) && input.exists(pointer.cli))
    return { source: "pointer", binary: pointer.cli, version: pointer.version }

  if (input.env.REDCODE_BIN) return { source: "development", binary: input.env.REDCODE_BIN }

  // PATH is only a name, resolved when the CLI is spawned.
  return { source: "development", binary: executable }
}

const decodePointer = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String, cli: Schema.String, app: Schema.String })),
)
