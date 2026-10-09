#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { rm } from "node:fs/promises"
import { Script } from "@opencode/script"
import { publishRelease, registryLookup } from "./publish-registry"
import { RedcodePackages } from "./packages"

const product = "redcode"
const packageName = "@reddb-io/redcode"
const packOnly = process.argv.includes("--pack-only")
const dir = path.resolve(import.meta.dir, "..")
if (Script.release && !process.env.REDCODE_VERSION)
  throw new Error("REDCODE_VERSION must be set explicitly for a Redcode release")

process.chdir(dir)

async function published(name: string, version: string) {
  const spec = `${name}@${version}`
  const result = await $`npm view ${spec} version --prefer-online --json`.quiet().nothrow()
  return registryLookup(spec, { exitCode: result.exitCode, stderr: result.stderr.toString() })
}

async function pack(target: string) {
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(target)
  for (const file of new Bun.Glob("*.tgz").scanSync({ cwd: target })) await rm(path.join(target, file))
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

const manifests = await RedcodePackages.list("./dist", Script.version)
if (!manifests.some((item) => item.kind === "cli")) throw new Error("no Redcode binary packages were built")
for (const item of manifests) {
  // Every CLI package names its target's design app as an optional dependency, so both must ship. The desktop app is
  // too large for the registry and only ships in the release archives.
  if (item.kind === "cli") RedcodePackages.design(manifests, item)
  for (const name of RedcodePackages.files(item)) {
    const file = path.join(item.dir, name)
    if (!(await Bun.file(file).exists())) throw new Error(`missing release file: ${file}`)
  }
}

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

RedDB's terminal coding agent, built on OpenCode V2 with Redcode's Session, Design, and automation features.

## Install

\`\`\`bash
npm install -g @reddb-io/redcode
redcode
\`\`\`

One native package for Linux (glibc and musl), macOS, and Windows on x64 and arm64. It includes the
\`redcode-rpc-sidecar\` companion for framed JSON/TOON RPC integrations, and the design app
(\`redcode-design\`) that serves Design mode's browser review ships alongside it, so nothing is
downloaded on first use.

Redcode Desktop is not included in the npm package. Install Redcode with mise
(\`mise use -g github:reddb-io/redcode@latest\`) or from a
[release archive](https://github.com/reddb-io/redcode/releases) to get the desktop app with
\`redcode desktop\`.

## Use

| Command | What it does |
| --- | --- |
| \`redcode\` | Terminal UI |
| \`redcode run\` | Non-interactive prompt |
| \`redcode serve\` | Headless HTTP server |
| \`redcode acp\` | Agent Client Protocol agent, for editors that speak ACP |
| \`redcode --help\` | Everything else |

Full documentation: https://github.com/reddb-io/redcode

## Built on

Redcode is built on [OpenCode](https://github.com/anomalyco/opencode). MIT licensed; see
[NOTICE](https://github.com/reddb-io/redcode/blob/main/NOTICE) for attribution.
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
        manifests
          .map((item) => item.manifest)
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map((item) => [item.name, item.version]),
      ),
    },
    null,
    2,
  ),
)

const platforms = manifests.map((item) => ({
  name: item.manifest.name,
  version: item.manifest.version,
  publish: () => packAndPublish(item.dir, item.manifest.name),
}))
const main = { name: packageName, version: Script.version, publish: () => packAndPublish(meta, packageName) }

if (packOnly) {
  for (let index = 0; index < manifests.length; index += 3)
    await Promise.all(manifests.slice(index, index + 3).map((item) => pack(item.dir)))
  await pack(meta)
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
