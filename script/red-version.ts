#!/usr/bin/env bun

import path from "path"

const root = path.resolve(import.meta.dir, "..")
const version = process.argv.find((arg) => /^\d+\.\d+\.\d+$/.test(arg))
const check = process.argv.includes("--check")

if (!version) throw new Error("usage: bun script/red-version.ts <major.minor.patch> [--check]")

const files = ["package.json", "packages/redcode/package.json"]
const manifests = await Promise.all(
  files.map(async (file) => ({ file, value: await Bun.file(path.join(root, file)).json() })),
)

if (check) {
  const mismatched = manifests.filter((item) => item.value.version !== version)
  if (mismatched.length > 0)
    throw new Error(`v${version} does not match ${mismatched.map((item) => item.file).join(", ")}`)
  console.log(`Redcode version surfaces match ${version}`)
  process.exit(0)
}

await Promise.all(
  manifests.map((item) =>
    Bun.write(path.join(root, item.file), `${JSON.stringify({ ...item.value, version }, null, 2)}\n`),
  ),
)
console.log(`Redcode version surfaces updated to ${version}`)
