#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { rm } from "node:fs/promises"
import { Script } from "@opencode-ai/script"

const product = "redcode"
const packageName = "@reddb-io/redcode"
const packOnly = process.argv.includes("--pack-only")
const dir = path.resolve(import.meta.dir, "..")

process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${`${name}@${version}`} version`.quiet().nothrow()).exitCode === 0
}

async function packAndPublish(target: string, name: string, version: string) {
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(target)
  await $`bun pm pack`.cwd(target)
  if (packOnly) return
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return
  }
  const tarball = Array.from(new Bun.Glob("*.tgz").scanSync({ cwd: target })).at(0)
  if (!tarball) throw new Error(`${name} did not produce a tarball`)
  await $`npm publish ${tarball} --access public --provenance --tag ${Script.channel}`.cwd(target)
}

const binaries = Array.from(new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })).map((file) => ({
  dir: path.join("./dist", path.dirname(file)),
  package: Bun.file(path.join("./dist", file)).json() as Promise<{ name: string; version: string }>,
}))
const manifests = await Promise.all(binaries.map(async (item) => ({ ...item, package: await item.package })))
if (manifests.length === 0) throw new Error("no Redcode binary packages were built")
if (manifests.some((item) => !item.package.name.startsWith(`${packageName}-`)))
  throw new Error("dist contains a binary package outside the @reddb-io/redcode namespace")
if (manifests.some((item) => item.package.version !== Script.version))
  throw new Error(`binary package version does not match ${Script.version}`)

const meta = `./dist/${product}-package`
await rm(meta, { recursive: true, force: true })
await $`mkdir -p ${path.join(meta, "bin")}`
await $`cp ./bin/opencode ${path.join(meta, "bin", product)}`
await Bun.file(path.join(meta, "LICENSE")).write(await Bun.file("../../LICENSE").text())
await Bun.file(path.join(meta, "README.md")).write(
  `# Redcode\n\nInstall with \`npm install -g @reddb-io/redcode\`, then run \`redcode\`.\n`,
)
await Bun.file(path.join(meta, "package.json")).write(
  JSON.stringify(
    {
      name: packageName,
      version: Script.version,
      description: "RedDB's AI coding agent for the terminal",
      license: "MIT",
      repository: { type: "git", url: "https://github.com/reddb-io/redcode" },
      bin: { [product]: `./bin/${product}` },
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: Object.fromEntries(
        manifests.map((item) => [item.package.name, item.package.version]).toSorted(([a], [b]) => a.localeCompare(b)),
      ),
    },
    null,
    2,
  ),
)

await Promise.all(manifests.map((item) => packAndPublish(item.dir, item.package.name, item.package.version)))
await packAndPublish(meta, packageName, Script.version)
