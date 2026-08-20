#!/usr/bin/env bun

import { $ } from "bun"

const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json()
if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version))
  throw new Error("package.json has no exact semantic version")

const tag = `v${manifest.version}`
const remote = await $`git ls-remote --exit-code --tags origin ${`refs/tags/${tag}`}`.quiet().nothrow()
if (remote.exitCode === 0) {
  console.log(`${tag} already exists on origin — release already handed off`)
  process.exit(0)
}

const local = await $`git rev-parse --verify ${`refs/tags/${tag}`}`.quiet().nothrow()
if (local.exitCode !== 0) await $`git tag -a ${tag} -m ${`Redcode ${manifest.version}`}`
await $`git push origin ${`refs/tags/${tag}`}`.env({ ...process.env, HUSKY: "0" })
console.log(`pushed ${tag}; red-publish will take over`)
