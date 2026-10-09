export * as RedcodePackages from "./packages"

import path from "node:path"

// The per-platform npm packages a Redcode release is made of, as folders of dist/: the CLI
// (`redcode-<target>`, @reddb-io/redcode-<target>), the design app that ships beside it
// (`redcode-design-<target>`, @reddb-io/redcode-design-<target>) and the Electron desktop app
// (`redcode-desktop-<os>-<arch>`, @reddb-io/redcode-desktop-<os>-<arch>), which only exists for glibc, macOS and
// Windows and serves the baseline CLI targets too. `redcode-package/` is the meta package publish.ts writes, never a
// platform package. A new kind is one more row in `kinds`.

export type Kind = "cli" | "design" | "desktop"

// The first prefix a folder starts with decides its kind, so the longer prefixes come first.
const kinds: { kind: Kind; prefix: string; binaries: string[] }[] = [
  { kind: "design", prefix: "redcode-design-", binaries: ["redcode-design"] },
  { kind: "desktop", prefix: "redcode-desktop-", binaries: [] },
  { kind: "cli", prefix: "redcode-", binaries: ["redcode", "redcode-rpc-sidecar"] },
]

/**
 * The desktop app inside its npm package: one tar of the unpacked app, because npm packers drop symlinks (the macOS
 * app bundle has them) and node_modules folders (the app's own `resources/app.asar.unpacked/node_modules`).
 */
export const DESKTOP_TAR = "desktop/desktop.tar"

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

/** The design app binaries packages/design-app built: `REDCODE_DESIGN_DIST`, by default its dist/. */
export function designDist(directory: string) {
  return path.resolve(directory, process.env.REDCODE_DESIGN_DIST ?? "../design-app/dist")
}

/**
 * The unpacked desktop apps: `REDCODE_DESKTOP_DIST`, by default packages/desktop/dist. It holds one `<os>-<arch>`
 * folder per desktop target with exactly what goes under `desktop/` beside redcode: the contents of electron-builder's
 * `linux-unpacked` or `win-unpacked` folder, or the `Redcode.app` bundle on macOS.
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
  if (item.kind === "desktop") return [DESKTOP_TAR]
  return binaries(item).map((name) => `bin/${name}`)
}

/** The design app package of a CLI package's target, which `bun run assemble` writes. */
export function design(packages: Package[], cli: Package) {
  const found = packages.find((item) => item.kind === "design" && item.target === cli.target)
  if (!found)
    throw new Error(`Missing @reddb-io/redcode-design-${cli.target} beside ${cli.manifest.name}; run bun run assemble`)
  return found
}

/** The `<os>-<arch>` desktop app of a CLI target: baseline targets share it, and musl targets have none. */
export function desktopTarget(target: string) {
  if (target.endsWith("-musl")) return undefined
  return target.replace(/-baseline$/, "")
}

/** The desktop app package of a CLI package's target, which `bun run assemble` writes; none on musl. */
export function desktop(packages: Package[], cli: Package) {
  const target = desktopTarget(cli.target)
  if (!target) return undefined
  const found = packages.find((item) => item.kind === "desktop" && item.target === target)
  if (!found)
    throw new Error(`Missing @reddb-io/redcode-desktop-${target} beside ${cli.manifest.name}; run bun run assemble`)
  return found
}
