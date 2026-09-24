export * as DesignAppBinary from "./app-binary"

import path from "node:path"
import { existsSync } from "node:fs"
import { chmod, mkdir, readdir, rename, rm } from "node:fs/promises"
import { Option, Schema } from "effect"
import { Global } from "../global"

/**
 * Where the design app (`redcode-design`) comes from. It is released on its own as `design-vX.Y.Z`
 * GitHub releases, one archive per platform with a manifest and SHA256SUMS, and a compiled redcode
 * downloads it the first time Design needs it, into `Global.Path.bin/redcode-design-<version>`.
 */

declare const REDCODE_DESIGN_APP_VERSION: string | undefined
declare const REDCODE_TARGET: string | undefined

/** The design app release this redcode was built with: the version it runs by default and the oldest it accepts. */
export const MINIMUM = typeof REDCODE_DESIGN_APP_VERSION === "string" ? REDCODE_DESIGN_APP_VERSION : undefined

export const DOWNLOAD = "https://github.com/reddb-io/redcode/releases/download"
export const RELEASES = "https://api.github.com/repos/reddb-io/redcode/releases"

/** What a release says about itself; the archive is installed only when it speaks redcode's protocol. */
export const Manifest = Schema.Struct({ version: Schema.String, protocol: Schema.Int })
export type Manifest = typeof Manifest.Type

export interface Options {
  /** The protocol this redcode speaks; releases speaking another are refused. */
  readonly protocol: number
  /** `design.app.version`: "latest" or an exact version. Default: the release redcode was built with. */
  readonly version?: string
  readonly minimum?: string
  readonly env?: Record<string, string | undefined>
  /** The design app's entry in a source checkout, run with Bun; false when there is none. */
  readonly source?: string | false
  readonly bin?: string
  /** Release platform, as the archives name it: linux-x64, darwin-arm64, windows-x64-baseline… */
  readonly target?: string
  readonly download?: string
  readonly releases?: string
  readonly fetch?: (url: string, init: { signal: AbortSignal; headers?: Record<string, string> }) => Promise<Response>
  readonly timeout?: number
}

/**
 * How to start the design app, first match wins: `REDCODE_DESIGN_BIN`, the source of this checkout
 * run with Bun, the installed release, or that release downloaded and verified now.
 */
export async function command(options: Options): Promise<string[]> {
  const bin = (options.env ?? process.env).REDCODE_DESIGN_BIN?.trim()
  if (bin) return [bin]
  const source = options.source ?? checkout()
  if (source) return [process.execPath, source]
  return [await install(options)]
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

export function archive(platform: string) {
  return `redcode-design-${platform}.${platform.startsWith("linux") ? "tar.gz" : "zip"}`
}

/** The installed binary of a version, downloading and verifying it first when it is missing. */
export async function install(options: Options) {
  const bin = options.bin ?? Global.Path.bin
  const platform = options.target ?? target()
  const version = await resolve(options, bin)
  const file = path.join(bin, `redcode-design-${version}${platform.startsWith("windows") ? ".exe" : ""}`)
  const installed = await manifest(path.join(bin, `redcode-design-${version}.json`))
  if (installed && installed.protocol !== options.protocol)
    throw mismatch(version, installed.protocol, options.protocol)
  if (installed && (await Bun.file(file).exists())) return file
  await download({ ...options, version, platform, bin, file })
  return file
}

/** The exact version to run: the requested one, the built-in one, or the newest compatible release. */
async function resolve(options: Options, bin: string) {
  const minimum = options.minimum ?? MINIMUM
  const requested = options.version ?? minimum ?? "latest"
  if (requested !== "latest") {
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(requested))
      throw new Error(`design.app.version must be "latest" or an exact version such as 0.1.0, not "${requested}"`)
    if (minimum && Bun.semver.order(requested, minimum) < 0)
      throw new Error(
        `design.app.version ${requested} is older than ${minimum}, the oldest design app this redcode works with`,
      )
    return requested
  }
  const listed = await releases(options, minimum).catch((error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  )
  if (Array.isArray(listed)) {
    for (const version of listed) {
      const remote = await fetchManifest(options, version).catch(() => undefined)
      if (remote?.protocol === options.protocol) return version
    }
  }
  // Offline, or nothing published fits: the newest compatible release already installed.
  const cached = (
    await Promise.all(
      (await readdir(bin).catch((): string[] => []))
        .flatMap((name) => /^redcode-design-(.+)\.json$/.exec(name)?.[1] ?? [])
        .map(async (version) => ({
          version,
          manifest: await manifest(path.join(bin, `redcode-design-${version}.json`)),
        })),
    )
  )
    .filter((item) => item.manifest?.protocol === options.protocol)
    .filter((item) => !minimum || Bun.semver.order(item.version, minimum) >= 0)
    .map((item) => item.version)
    .sort((a, b) => Bun.semver.order(b, a))
  if (cached[0]) return cached[0]
  if (Array.isArray(listed))
    throw new Error(`No design app release speaks protocol ${options.protocol}; update redcode`)
  throw new Error(
    `Could not list design app releases (${listed.message}); set design.app.version to an exact version or connect to the network`,
  )
}

/** Published `design-v*` versions, newest first, no older than the minimum. */
async function releases(options: Options, minimum: string | undefined) {
  const response = await get(options, `${options.releases ?? RELEASES}?per_page=100`, {
    accept: "application/vnd.github+json",
  })
  const listed = Schema.decodeUnknownOption(
    Schema.Array(Schema.Struct({ tag_name: Schema.String, draft: Schema.Boolean, prerelease: Schema.Boolean })),
  )(await response.json())
  if (Option.isNone(listed)) throw new Error("the releases API answered in an unexpected shape")
  return listed.value
    .filter((release) => !release.draft && !release.prerelease && /^design-v\d+\.\d+\.\d+$/.test(release.tag_name))
    .map((release) => release.tag_name.slice("design-v".length))
    .filter((version) => !minimum || Bun.semver.order(version, minimum) >= 0)
    .sort((a, b) => Bun.semver.order(b, a))
}

async function fetchManifest(options: Options, version: string) {
  const bytes = await (await get(options, `${base(options, version)}/manifest.json`)).bytes()
  return { ...decodeManifest(bytes, version), bytes }
}

async function download(input: Options & { version: string; platform: string; bin: string; file: string }) {
  const asset = archive(input.platform)
  // The manifest is checked before the archive is fetched: a release of another protocol is refused outright.
  const remote = await fetchManifest(input, input.version)
  if (remote.protocol !== input.protocol) throw mismatch(input.version, remote.protocol, input.protocol)
  const sums = await (await get(input, `${base(input, input.version)}/SHA256SUMS`)).text()
  const expected = (file: string) =>
    sums
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .find(([, name]) => name === file)?.[0]
      ?.toLowerCase()
  verify(input.version, "manifest.json", remote.bytes, expected("manifest.json"))
  const bytes = await (await get(input, `${base(input, input.version)}/${asset}`)).bytes()
  verify(input.version, asset, bytes, expected(asset))
  await mkdir(input.bin, { recursive: true })
  const temporary = path.join(input.bin, `.redcode-design-${input.version}-${crypto.randomUUID()}`)
  await mkdir(temporary)
  try {
    await Bun.write(path.join(temporary, asset), bytes)
    await extract(temporary, asset)
    const binary = path.join(temporary, `redcode-design${input.platform.startsWith("windows") ? ".exe" : ""}`)
    if (!(await Bun.file(binary).exists()))
      throw new Error(`The design app ${input.version} archive ${asset} does not contain ${path.basename(binary)}`)
    if (!input.platform.startsWith("windows")) await chmod(binary, 0o755)
    await rename(binary, input.file)
    // Written last: an installed version is one whose manifest exists beside its binary.
    await Bun.write(path.join(input.bin, `redcode-design-${input.version}.json`), remote.bytes)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function extract(directory: string, asset: string) {
  // GNU tar (first on PATH under Git for Windows) reads a drive letter such as `C:` as a remote host,
  // so tar only ever sees a name relative to the directory it runs in.
  const child = asset.endsWith(".zip")
    ? Bun.spawn(
        [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${path.join(directory, asset).replaceAll("'", "''")}' -DestinationPath '${directory.replaceAll("'", "''")}' -Force`,
        ],
        { stdout: "ignore", stderr: "pipe" },
      )
    : Bun.spawn(["tar", "-xzf", asset], { cwd: directory, stdout: "ignore", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0)
    throw new Error(`Could not unpack the design app archive ${asset}: ${stderr.trim() || `exit ${code}`}`)
}

function verify(version: string, file: string, bytes: Uint8Array, expected: string | undefined) {
  if (!expected) throw new Error(`The design app ${version} release has no SHA256SUMS entry for ${file}`)
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
  if (actual !== expected)
    throw new Error(
      `The design app ${version} download is corrupt: ${file} has SHA-256 ${actual}, the release lists ${expected}; refusing to install it`,
    )
}

function mismatch(version: string, actual: number, expected: number) {
  return new Error(
    `The design app ${version} speaks protocol ${actual} but this redcode speaks ${expected}; set design.app.version to "latest" or a compatible version`,
  )
}

function decodeManifest(bytes: Uint8Array, version: string) {
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest))(new TextDecoder().decode(bytes))
  if (Option.isNone(decoded) || decoded.value.version !== version)
    throw new Error(`The design app ${version} release has an invalid manifest.json`)
  return decoded.value
}

async function manifest(file: string) {
  const text = await Bun.file(file)
    .text()
    .catch(() => undefined)
  if (!text) return undefined
  return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(Manifest))(text))
}

function base(options: Options, version: string) {
  return `${options.download ?? DOWNLOAD}/design-v${version}`
}

async function get(options: Options, url: string, headers?: Record<string, string>) {
  const response = await (options.fetch ?? fetch)(url, {
    signal: AbortSignal.timeout(options.timeout ?? 120_000),
    headers,
  }).catch((error: unknown) => {
    throw new Error(`Could not download ${url}: ${error instanceof Error ? error.message : String(error)}`)
  })
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`)
  return response
}
