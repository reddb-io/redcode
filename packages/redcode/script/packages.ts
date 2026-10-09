export * as RedcodePackages from "./packages"

import path from "node:path"

// The per-platform npm packages a Redcode release is made of, as folders of dist/: the CLI
// (`redcode-<target>`, @reddb-io/redcode-<target>) and the design app that ships beside it
// (`redcode-design-<target>`, @reddb-io/redcode-design-<target>). `redcode-package/` is the meta
// package publish.ts writes, never a platform package. A new kind is one more row in `kinds`.

export type Kind = "cli" | "design"

// The first prefix a folder starts with decides its kind, so the longer prefixes come first.
const kinds: { kind: Kind; prefix: string; binaries: string[] }[] = [
  { kind: "design", prefix: "redcode-design-", binaries: ["redcode-design"] },
  { kind: "cli", prefix: "redcode-", binaries: ["redcode", "redcode-rpc-sidecar"] },
]

export type Manifest = {
  name: string
  version: string
  license?: string
  repository?: unknown
  os: string[]
  cpu: string[]
  optionalDependencies?: Record<string, string>
}

export type Package = Awaited<ReturnType<typeof list>>[number]

/** The design app binaries packages/design-app built: `REDCODE_DESIGN_DIST`, by default its dist/. */
export function designDist(directory: string) {
  return path.resolve(directory, process.env.REDCODE_DESIGN_DIST ?? "../design-app/dist")
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

/** The design app package of a CLI package's target, which `bun run assemble` writes. */
export function design(packages: Package[], cli: Package) {
  const found = packages.find((item) => item.kind === "design" && item.target === cli.target)
  if (!found)
    throw new Error(`Missing @reddb-io/redcode-design-${cli.target} beside ${cli.manifest.name}; run bun run assemble`)
  return found
}
