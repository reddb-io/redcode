#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { rm } from "node:fs/promises"
import { Script } from "@reddb-io/redcode-script"
import { publishRelease } from "./publish-registry"

const product = "redcode"
const packageName = "@reddb-io/redcode"
const packOnly = process.argv.includes("--pack-only")
const dir = path.resolve(import.meta.dir, "..")

process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${`${name}@${version}`} version`.quiet().nothrow()).exitCode === 0
}

async function pack(target: string) {
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(target)
  await $`bun pm pack`.cwd(target)
}

// Called by publishRelease only after `npm view` missed this version. An E409 from npm here is
// treated as already published there, so rerunning a failed release job is safe.
async function packAndPublish(target: string, name: string) {
  await pack(target)
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
await $`cp ./bin/redcode ${path.join(meta, "bin", product)}`
await $`cp ./bin/redcode ${path.join(meta, "bin", "redcode-rpc-sidecar")}`
await Bun.file(path.join(meta, "LICENSE")).write(await Bun.file("../../LICENSE").text())
await Bun.file(path.join(meta, "NOTICE")).write(await Bun.file("../../NOTICE").text())
// The registry page is written here rather than copied from the repository README,
// which is full of relative links and a hero image that only resolve on GitHub.
await Bun.file(path.join(meta, "README.md")).write(`# Redcode

RedDB's terminal coding agent. Prompts are durable before they run, the runtime is reversible, and
the autonomous Worker fleet is on screen next to your session.

## Install

\`\`\`bash
npm install -g @reddb-io/redcode
redcode
\`\`\`

One native package for Linux (glibc and musl), macOS, and Windows on x64 and arm64. It includes the
\`redcode-rpc-sidecar\` companion for framed JSON/TOON RPC integrations.

## Use

| Command | What it does |
| --- | --- |
| \`redcode\` | Terminal UI — sessions, diffs, permissions, and the Worker fleet |
| \`redcode run\` | Non-interactive prompt |
| \`redcode serve\` | Headless HTTP server |
| \`redcode acp\` | Agent Client Protocol agent, for editors that speak ACP |
| \`redcode --help\` | Everything else |

Full documentation: https://github.com/reddb-io/redcode

## Built on

Redcode is built on [OpenCode](https://github.com/anomalyco/opencode), and its runtime composition is
modelled on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). MIT licensed; see
[NOTICE](https://github.com/reddb-io/redcode/blob/main/NOTICE) for full attribution.
`)
await Bun.file(path.join(meta, "package.json")).write(
  JSON.stringify(
    {
      name: packageName,
      version: Script.version,
      description: "RedDB's AI coding agent for the terminal",
      license: "MIT",
      repository: { type: "git", url: "https://github.com/reddb-io/redcode" },
      bin: { [product]: `./bin/${product}`, "redcode-rpc-sidecar": "./bin/redcode-rpc-sidecar" },
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

const platforms = manifests.map((item) => ({
  name: item.package.name,
  version: item.package.version,
  publish: () => packAndPublish(item.dir, item.package.name),
}))
const main = { name: packageName, version: Script.version, publish: () => packAndPublish(meta, packageName) }

if (packOnly) {
  for (const item of [...manifests.map((entry) => entry.dir), meta]) await pack(item)
} else {
  await publishRelease(
    { platforms, main },
    {
      published,
      sleep: (ms) => Bun.sleep(ms),
      now: () => Date.now(),
      log: (message) => console.log(message),
    },
  )
}
