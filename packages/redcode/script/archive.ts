#!/usr/bin/env bun

import { $ } from "bun"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { chmod, mkdir, rm, utimes } from "node:fs/promises"
import path from "node:path"
import { Script } from "@opencode/script"

const directory = path.resolve(import.meta.dir, "..")
const dist = path.resolve(directory, process.argv.find((arg) => arg.startsWith("--dist="))?.slice(7) ?? "dist")
const output = path.resolve(directory, process.argv.find((arg) => arg.startsWith("--outdir="))?.slice(9) ?? "release")
const manifests = Array.from(new Bun.Glob("redcode-*/package.json").scanSync({ cwd: dist }))
  .filter((file) => !file.startsWith("redcode-package/"))
  .toSorted()
if (manifests.length === 0) throw new Error(`No Redcode native packages in ${dist}`)
await mkdir(output, { recursive: true })

const archives = await Promise.all(manifests.map(async (manifest) => {
  const source = path.join(dist, path.dirname(manifest))
  const info = await Bun.file(path.join(dist, manifest)).json() as { name: string; version: string }
  const target = path.basename(source).replace(/^redcode-/, "")
  if (info.name !== `@reddb-io/redcode-${target}` || info.version !== Script.version)
    throw new Error(`Unexpected native package ${info.name}@${info.version} in ${source}`)
  const windows = target.startsWith("windows-")
  const names = ["redcode", "redcode-rpc-sidecar"].map((name) => `${name}${windows ? ".exe" : ""}`)
  for (const name of names) {
    const file = path.join(source, "bin", name)
    if (!(await Bun.file(file).exists())) throw new Error(`Missing release binary: ${file}`)
    if (!windows) await chmod(file, 0o755)
    await utimes(file, new Date("1980-01-01T00:00:00Z"), new Date("1980-01-01T00:00:00Z"))
  }
  const archive = path.join(output, `redcode-${target}.${target.startsWith("linux-") ? "tar.gz" : "zip"}`)
  await rm(archive, { force: true })
  if (target.startsWith("linux-"))
    await $`tar --mtime=@0 --owner=0 --group=0 --numeric-owner -czf ${archive} -C ${path.join(source, "bin")} ${names}`
  else
    await $`zip -X -q ${archive} ${names}`.cwd(path.join(source, "bin"))
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(archive)) hash.update(chunk)
  return { file: path.basename(archive), sha256: hash.digest("hex") }
}))

await Bun.write(path.join(output, "SHA256SUMS"), archives.map((item) => `${item.sha256}  ${item.file}`).join("\n") + "\n")
console.log(`Archived ${archives.length} Redcode native packages in ${output}`)
