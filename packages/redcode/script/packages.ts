export * as RedcodePackages from "./packages"

import path from "node:path"

// Each native package carries Redcode (including the Design child entry) and its RPC sidecar.
// Electron ships only in the full release archives; server archives and npm leave it out.
// `redcode-package/` is the meta package publish.ts writes, never a platform package. A new kind is one more row in
// `kinds`.

export type Kind = "cli"

// The first prefix a folder starts with decides its kind, so the longer prefixes come first.
const kinds: { kind: Kind; prefix: string; binaries: string[] }[] = [
  { kind: "cli", prefix: "redcode-", binaries: ["redcode", "redcode-rpc-sidecar"] },
]

export type Manifest = {
  name: string
  version: string
  license?: string
  repository?: unknown
  os: string[]
  cpu: string[]
  libc?: string[]
  optionalDependencies?: Record<string, string>
}

export type Package = Awaited<ReturnType<typeof list>>[number]

/** The whiteboard archive built by the Design release job. */
export function designDist(directory: string) {
  return path.resolve(directory, process.env.REDCODE_DESIGN_DIST ?? "../design-app/dist")
}

/**
 * The unpacked desktop apps the release archives carry: `REDCODE_DESKTOP_DIST`, by default packages/desktop/dist. It
 * holds one `<os>-<arch>` folder per desktop target with exactly what goes under `desktop/` beside redcode: the
 * contents of electron-builder's `linux-unpacked` or `win-unpacked` folder, or the `Redcode.app` bundle on macOS.
 */
export function desktopDist(directory: string) {
  return path.resolve(directory, process.env.REDCODE_DESKTOP_DIST ?? "../desktop/dist")
}

/** Every platform package in dist, checked to carry its own folder's name and this release's version. */
export async function list(dist: string, version: string) {
  const files = Array.from(new Bun.Glob("redcode-*/package.json").scanSync({ cwd: dist }))
    .filter((file) => path.dirname(file) !== "redcode-package")
    .toSorted()
  return Promise.all(
    files.map(async (file) => {
      const folder = path.dirname(file)
      const kind = kinds.find((item) => folder.startsWith(item.prefix))!
      const manifest = (await Bun.file(path.join(dist, file)).json()) as Manifest
      if (manifest.name !== `@reddb-io/${folder}` || manifest.version !== version)
        throw new Error(
          `Unexpected platform package ${manifest.name}@${manifest.version} in ${path.join(dist, folder)}`,
        )
      return {
        kind: kind.kind,
        target: folder.slice(kind.prefix.length),
        dir: path.join(dist, folder),
        manifest,
      }
    }),
  )
}

/** The executables a package must carry in bin/, with .exe on Windows. */
export function binaries(item: Pick<Package, "kind" | "target">) {
  const extension = item.target.startsWith("windows-") ? ".exe" : ""
  return kinds.find((kind) => kind.kind === item.kind)!.binaries.map((name) => `${name}${extension}`)
}

/** The files a package must carry, relative to its folder. */
export function files(item: Pick<Package, "kind" | "target">) {
  return binaries(item).map((name) => `bin/${name}`)
}

/** npm installs the compatible baseline once; optimized archives remain available separately. */
export function installation(packages: Package[]) {
  return packages.filter(
    (item) =>
      !packages.some(
        (other) => other.target.includes("-baseline") && other.target.replace("-baseline", "") === item.target,
      ),
  )
}

/** The `<os>-<arch>` folder of desktopDist a CLI target's archive carries: baseline targets share it, musl has none. */
export function desktopTarget(target: string) {
  if (target.endsWith("-musl")) return undefined
  return target.replace(/-baseline$/, "")
}
