#!/usr/bin/env bun

// Packs one release archive per target with redcode, its RPC sidecar, the design app and, outside musl, the unpacked
// desktop app under `desktop/`, taken from the CLI, design and desktop packages `bun run assemble` left in dist/,
// plus the whiteboard bundle the design app downloads from the same release. Windows archives are zip; the others are
// tar.gz, which keeps file modes and symlinks (the macOS app bundle has both).

import { $ } from "bun"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { chmod, mkdir, rm, utimes } from "node:fs/promises"
import path from "node:path"
import { Script } from "@opencode/script"
import { RedcodePackages } from "./packages"

const directory = path.resolve(import.meta.dir, "..")
const dist = path.resolve(directory, process.argv.find((arg) => arg.startsWith("--dist="))?.slice(7) ?? "dist")
const output = path.resolve(directory, process.argv.find((arg) => arg.startsWith("--outdir="))?.slice(9) ?? "release")
const packages = await RedcodePackages.list(dist, Script.version)
const cli = packages.filter((item) => item.kind === "cli")
if (cli.length === 0) throw new Error(`No Redcode native packages in ${dist}`)
const whiteboard = path.join(RedcodePackages.designDist(directory), `redcode-whiteboard-${Script.version}.tar.gz`)
if (!(await Bun.file(whiteboard).exists())) throw new Error(`Missing whiteboard bundle: ${whiteboard}`)
await mkdir(output, { recursive: true })

const archives = await Promise.all(
  cli.map(async (item) => {
    const contents = [item, RedcodePackages.design(packages, item)].map((source) => ({
      bin: path.join(source.dir, "bin"),
      names: RedcodePackages.binaries(source),
    }))
    const files = contents.flatMap((source) => source.names.map((name) => path.join(source.bin, name)))
    const windows = item.target.startsWith("windows-")
    for (const file of files) {
      if (!(await Bun.file(file).exists())) throw new Error(`Missing release binary: ${file}`)
      if (!windows) await chmod(file, 0o755)
      await utimes(file, new Date("1980-01-01T00:00:00Z"), new Date("1980-01-01T00:00:00Z"))
    }
    const archive = `redcode-${item.target}.${windows ? "zip" : "tar.gz"}`
    await rm(path.join(output, archive), { force: true })
    // The desktop app travels as a tar inside its package; unpacked here under `desktop/`, beside redcode.
    const desktop = RedcodePackages.desktop(packages, item)
    const stage = path.join(output, `.desktop-${item.target}`)
    await rm(stage, { recursive: true, force: true })
    if (desktop) {
      const tar = path.join(desktop.dir, RedcodePackages.DESKTOP_TAR)
      if (!(await Bun.file(tar).exists())) throw new Error(`Missing desktop app: ${tar}`)
      await mkdir(path.join(stage, "desktop"), { recursive: true })
      await $`tar -xf - < ${Bun.file(tar)}`.cwd(path.join(stage, "desktop"))
    }
    // GNU tar reads a Windows drive letter such as `C:` in an archive name as a remote host, so tar only sees
    // relative names, or the archive on stdin. zip runs a second time from the stage to keep the `desktop/` tree.
    if (windows) {
      await $`zip -X -q -j ${archive} ${files}`.cwd(output)
      if (desktop) await $`zip -X -q -r -y ${path.join("..", archive)} desktop`.cwd(stage)
    } else {
      await $`tar --mtime=@0 --owner=0 --group=0 --numeric-owner -czf ${archive} ${[
        ...contents.flatMap((source) => ["-C", source.bin, ...source.names]),
        ...(desktop ? ["-C", stage, "desktop"] : []),
      ]}`.cwd(output)
    }
    await rm(stage, { recursive: true, force: true })
    return archive
  }),
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
console.log(`Archived ${archives.length} Redcode native packages with the design and desktop apps in ${output}`)
