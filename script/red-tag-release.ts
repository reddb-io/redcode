#!/usr/bin/env bun

import { $ } from "bun"

const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json()
if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version))
  throw new Error("package.json has no exact semantic version")
const design = await Bun.file(new URL("../packages/design-app/package.json", import.meta.url)).json()
if (typeof design.version !== "string" || !/^\d+\.\d+\.\d+$/.test(design.version))
  throw new Error("packages/design-app/package.json has no exact semantic version")

// The design app first, so its release (design-publish) is on its way before the redcode that
// downloads it (red-publish). 0.0.0 was never released.
if (design.version !== "0.0.0")
  await push(`design-v${design.version}`, `Redcode Design ${design.version}`, "design-publish")
await push(`v${manifest.version}`, `Redcode ${manifest.version}`, "red-publish")

async function push(tag: string, message: string, workflow: string) {
  const remote = await $`git ls-remote --exit-code --tags origin ${`refs/tags/${tag}`}`.quiet().nothrow()
  if (remote.exitCode === 0) {
    console.log(`${tag} already exists on origin — release already handed off`)
    return
  }
  const local = await $`git rev-parse --verify ${`refs/tags/${tag}`}`.quiet().nothrow()
  if (local.exitCode !== 0) await $`git tag -a ${tag} -m ${message}`
  await $`git push origin ${`refs/tags/${tag}`}`.env({ ...process.env, HUSKY: "0" })
  console.log(`pushed ${tag}; ${workflow} will take over`)
}
