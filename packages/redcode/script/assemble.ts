#!/usr/bin/env bun

// Ships the design app and the desktop app beside redcode. For every redcode platform package in dist/, writes the
// @reddb-io/redcode-design-<target> package from the binary packages/design-app built for that target
// (REDCODE_DESIGN_DIST) and, outside musl, the @reddb-io/redcode-desktop-<os>-<arch> package from the unpacked app
// packages/desktop built for it (REDCODE_DESKTOP_DIST, see RedcodePackages.desktopDist). Both become optional
// dependencies of the CLI package too, so pnpm's isolated layout links them next to redcode, where the CLI looks for
// them. Runs after `bun run build`, before `bun run archive` and `bun run publish`.

import { $ } from "bun"
import { chmod, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { Script } from "@opencode/script"
import { RedcodePackages } from "./packages"

const directory = path.resolve(import.meta.dir, "..")
const dist = path.resolve(directory, process.argv.find((arg) => arg.startsWith("--dist="))?.slice(7) ?? "dist")
const source = RedcodePackages.designDist(directory)
const desktopSource = RedcodePackages.desktopDist(directory)
const cli = (await RedcodePackages.list(dist, Script.version)).filter((item) => item.kind === "cli")
if (cli.length === 0) throw new Error(`No Redcode native packages in ${dist}`)

const manifest = (item: RedcodePackages.Package, name: string, extra = {}) =>
  JSON.stringify(
    {
      name,
      version: Script.version,
      license: item.manifest.license,
      repository: item.manifest.repository,
      os: item.manifest.os,
      cpu: item.manifest.cpu,
      ...extra,
    },
    null,
    2,
  )

const notices = (output: string) =>
  Promise.all([
    Bun.write(path.join(output, "LICENSE"), Bun.file(path.join(directory, "../../LICENSE"))),
    Bun.write(path.join(output, "NOTICE"), Bun.file(path.join(directory, "../../NOTICE"))),
  ])

await Promise.all(
  cli.map(async (item) => {
    const name = `@reddb-io/redcode-design-${item.target}`
    const output = path.join(dist, `redcode-design-${item.target}`)
    const binary = RedcodePackages.binaries({ kind: "design", target: item.target })[0]!
    const built = path.join(source, `redcode-design-${item.target}`, binary)
    if (!(await Bun.file(built).exists())) throw new Error(`Missing design app for ${item.target}: ${built}`)
    await rm(output, { recursive: true, force: true })
    await Bun.write(path.join(output, "bin", binary), Bun.file(built))
    if (!item.target.startsWith("windows-")) await chmod(path.join(output, "bin", binary), 0o755)
    await notices(output)
    await Bun.write(path.join(output, "package.json"), manifest(item, name))
    const desktop = RedcodePackages.desktopTarget(item.target)
    await Bun.write(
      path.join(item.dir, "package.json"),
      JSON.stringify(
        {
          ...item.manifest,
          optionalDependencies: {
            [name]: Script.version,
            ...(desktop ? { [`@reddb-io/redcode-desktop-${desktop}`]: Script.version } : {}),
          },
        },
        null,
        2,
      ),
    )
  }),
)

// Baseline targets share their os/arch desktop app, so each one is packed once.
const desktops = new Map(
  cli.flatMap((item) => {
    const target = RedcodePackages.desktopTarget(item.target)
    return target ? [[target, item] as const] : []
  }),
)
await Promise.all(
  [...desktops].map(async ([target, item]) => {
    const built = path.join(desktopSource, target)
    const entries = await readdir(built).catch(() => [])
    if (entries.length === 0) throw new Error(`Missing desktop app for ${target}: ${built}`)
    const output = path.join(dist, `redcode-desktop-${target}`)
    await rm(output, { recursive: true, force: true })
    const tar = path.join(output, RedcodePackages.DESKTOP_TAR)
    await mkdir(path.dirname(tar), { recursive: true })
    // tar runs in the output directory and only sees the archive's own name: GNU tar reads a Windows drive letter
    // such as `C:` in it as a remote host. The tar keeps the app's symlinks and file modes.
    await $`tar --mtime=@0 --owner=0 --group=0 --numeric-owner -cf ${path.basename(tar)} -C ${built} ${entries}`.cwd(
      path.dirname(tar),
    )
    await notices(output)
    // The desktop app links against glibc; the CLI's musl targets have no desktop package.
    await Bun.write(
      path.join(output, "package.json"),
      manifest(item, `@reddb-io/redcode-desktop-${target}`, item.manifest.os.includes("linux") ? { libc: ["glibc"] } : {}),
    )
  }),
)
console.log(
  `Assembled the design app beside ${cli.length} Redcode native packages and ${desktops.size} desktop apps in ${dist}`,
)
