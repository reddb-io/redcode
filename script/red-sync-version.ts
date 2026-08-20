#!/usr/bin/env bun

import path from "path"

const root = path.resolve(import.meta.dir, "..")
const product = await Bun.file(path.join(root, "packages/opencode/package.json")).json()
if (typeof product.version !== "string" || !/^\d+\.\d+\.\d+$/.test(product.version))
  throw new Error("packages/opencode/package.json has no exact semantic version")

const workspace = await Bun.file(path.join(root, "package.json")).json()
await Bun.write(path.join(root, "package.json"), `${JSON.stringify({ ...workspace, version: product.version }, null, 2)}\n`)
console.log(`Redcode version surfaces updated to ${product.version}`)
