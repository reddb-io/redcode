#!/usr/bin/env bun

// Packs full and server archives per target with Redcode (including Design) and its RPC sidecar.
// Full archives also carry the desktop app under `desktop/` outside musl: the native packages in dist/, the desktop app straight
// from REDCODE_DESKTOP_DIST (only archives carry it, npm does not), plus the whiteboard bundle the design app downloads
// from the same release. Windows archives are zip; the others are tar.gz, which keeps file modes and symlinks (the
// macOS app bundle has both).

import { BlobReader, TextReader, ZipWriter } from "@zip.js/zip.js"
import { createHash } from "node:crypto"
import { constants, createReadStream, createWriteStream } from "node:fs"
import { chmod, copyFile, cp, lstat, mkdir, readdir, readlink, rm } from "node:fs/promises"
import path from "node:path"
import { Writable } from "node:stream"
import { Script } from "@opencode/script"
import { create } from "tar"
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
// Reject incomplete inputs before writing any release files.
const apps = new Set<string>()
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
  apps.add(desktop)
}
await mkdir(output, { recursive: true })

const archives = await Promise.all(
  cli.flatMap((item) =>
    ["full", "server"].map(async (profile) => {
      const bin = path.join(item.dir, "bin")
      const names = RedcodePackages.binaries(item)
      const windows = item.target.startsWith("windows-")
      const archive = `redcode-${profile === "server" ? "server-" : ""}${item.target}.${windows ? "zip" : "tar.gz"}`
      await rm(path.join(output, archive), { force: true })
      const desktop = profile === "full" ? RedcodePackages.desktopTarget(item.target) : undefined
      const stage = path.join(output, `.desktop-${profile}-${item.target}`)
      await rm(stage, { recursive: true, force: true })
      await mkdir(stage, { recursive: true })
      try {
        // Reflink where supported, copy otherwise. Keep input binaries untouched and symlinks relative.
        for (const name of names) {
          await copyFile(path.join(bin, name), path.join(stage, name), constants.COPYFILE_FICLONE)
          if (!windows) await chmod(path.join(stage, name), 0o755)
        }
        if (desktop)
          await cp(path.join(desktops, desktop), path.join(stage, "desktop"), {
            recursive: true,
            verbatimSymlinks: true,
            mode: constants.COPYFILE_FICLONE,
          })
        const files = await archiveEntries(stage)
        if (windows) await zip(stage, path.join(output, archive), files)
        if (!windows)
          await create(
            {
              cwd: stage,
              file: path.join(output, archive),
              gzip: true,
              portable: true,
              mtime: new Date(0),
              noDirRecurse: true,
            },
            files,
          )
      } finally {
        await rm(stage, { recursive: true, force: true })
      }
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

async function archiveEntries(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const name = path.posix.join(prefix, entry.name)
      return entry.isDirectory() ? [name, ...(await archiveEntries(directory, name))] : [name]
    }),
  )
  return files.flat().toSorted()
}

async function zip(directory: string, file: string, files: string[]) {
  const stream = createWriteStream(file)
  const writer = new ZipWriter(Writable.toWeb(stream), {
    lastModDate: new Date(1980, 0, 1),
    extendedTimestamp: false,
    versionMadeBy: (3 << 8) | 20,
  })
  try {
    for (const name of files) {
      const source = path.join(directory, name)
      const stat = await lstat(source)
      await writer.add(
        stat.isDirectory() ? `${name}/` : name,
        stat.isDirectory()
          ? undefined
          : stat.isSymbolicLink()
            ? new TextReader(await readlink(source))
            : new BlobReader(Bun.file(source)),
        { directory: stat.isDirectory(), externalFileAttributes: (stat.mode << 16) >>> 0, useWebWorkers: false },
      )
    }
    await writer.close()
  } finally {
    stream.destroy()
  }
}
