#!/usr/bin/env bun

// Packs full and server archives per target with Redcode (including Design) and its RPC sidecar.
// Full archives also carry the desktop app under `desktop/` outside musl: the native packages in dist/, the desktop app straight
// from REDCODE_DESKTOP_DIST (only archives carry it, npm does not), plus the whiteboard bundle the design app downloads
// from the same release. Windows archives are zip; the others are tar.gz, which keeps file modes and symlinks (the
// macOS app bundle has both).

import { $ } from "bun"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { chmod, mkdir, readdir, rm, utimes } from "node:fs/promises"
import path from "node:path"
import { Script } from "@opencode/script"
import { RedcodePackages } from "./packages"

const directory = path.resolve(import.meta.dir, "..")
const dist = path.resolve(directory, process.argv.find((arg) => arg.startsWith("--dist="))?.slice(7) ?? "dist")
const output = path.resolve(directory, process.argv.find((arg) => arg.startsWith("--outdir="))?.slice(9) ?? "release")
const desktops = RedcodePackages.desktopDist(directory)
const packages = await RedcodePackages.list(dist, Script.version)
const cli = packages.filter((item) => item.kind === "cli")
if (cli.length === 0) throw new Error(`No Redcode native packages in ${dist}`)
const whiteboard = path.join(RedcodePackages.designDist(directory), `redcode-whiteboard-${Script.version}.tar.gz`)
if (!(await Bun.file(whiteboard).exists())) throw new Error(`Missing whiteboard bundle: ${whiteboard}`)
// Reject incomplete inputs before starting archive processes, whose working directories
// otherwise remain locked on Windows when another concurrent target fails validation.
const apps = new Map<string, string[]>()
for (const item of cli) {
  for (const name of RedcodePackages.binaries(item)) {
    const file = path.join(item.dir, "bin", name)
    if (!(await Bun.file(file).exists())) throw new Error(`Missing release binary: ${file}`)
  }
  const desktop = RedcodePackages.desktopTarget(item.target)
  if (!desktop || apps.has(desktop)) continue
  const built = path.join(desktops, desktop)
  const entries = await readdir(built).catch(() => [])
  if (entries.length === 0) throw new Error(`Missing desktop app for ${desktop}: ${built}`)
  apps.set(desktop, entries)
}
await mkdir(output, { recursive: true })

await Promise.all(
  cli.map(async (item) => {
    for (const name of RedcodePackages.binaries(item)) {
      const file = path.join(item.dir, "bin", name)
      if (!item.target.startsWith("windows-")) await chmod(file, 0o755)
      await utimes(file, new Date("1980-01-01T00:00:00Z"), new Date("1980-01-01T00:00:00Z"))
    }
  }),
)

const archives = await Promise.all(
  cli.flatMap((item) =>
    ["full", "server"].map(async (profile) => {
      const bin = path.join(item.dir, "bin")
      const names = RedcodePackages.binaries(item)
      const files = names.map((name) => path.join(bin, name))
      const windows = item.target.startsWith("windows-")
      const archive = `redcode-${profile === "server" ? "server-" : ""}${item.target}.${windows ? "zip" : "tar.gz"}`
      await rm(path.join(output, archive), { force: true })
      // The desktop app is staged under `desktop/`, beside redcode; a tar pipe keeps its symlinks and file modes.
      const desktop = profile === "full" ? RedcodePackages.desktopTarget(item.target) : undefined
      const stage = path.join(output, `.desktop-${profile}-${item.target}`)
      await rm(stage, { recursive: true, force: true })
      if (desktop) {
        const built = path.join(desktops, desktop)
        const entries = apps.get(desktop)!
        await mkdir(path.join(stage, "desktop"), { recursive: true })
        await $`tar -cf - -C ${built} ${entries} | tar -xf -`.cwd(path.join(stage, "desktop"))
      }
      // GNU tar reads a Windows drive letter such as `C:` in an archive name as a remote host, so tar only sees
      // relative names, or the archive on stdin. zip runs a second time from the stage to keep the `desktop/` tree.
      if (windows) {
        await $`zip -X -q -j ${archive} ${files}`.cwd(output)
        if (desktop) await $`zip -X -q -r -y ${path.join("..", archive)} desktop`.cwd(stage)
      } else {
        await $`tar --mtime=@0 --owner=0 --group=0 --numeric-owner -czf ${archive} ${[
          "-C",
          bin,
          ...names,
          ...(desktop ? ["-C", stage, "desktop"] : []),
        ]}`.cwd(output)
      }
      await rm(stage, { recursive: true, force: true })
      return archive
    }),
  ),
)
await Bun.write(path.join(output, path.basename(whiteboard)), Bun.file(whiteboard))

const sums = await Promise.all(
  [...archives, path.basename(whiteboard)].map(async (file) => {
    const hash = createHash("sha256")
    for await (const chunk of createReadStream(path.join(output, file))) hash.update(chunk)
    return `${hash.digest("hex")}  ${file}`
  }),
)
await Bun.write(path.join(output, "SHA256SUMS"), sums.join("\n") + "\n")
console.log(`Archived ${archives.length} full and server distributions in ${output}`)
