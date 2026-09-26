#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"

const extension = process.platform === "win32" ? ".exe" : ""
const output = path.resolve(
  import.meta.dir,
  "..",
  process.env.REDCODE_RPC_SIDECAR_OUTPUT ?? `dist/redcode-rpc-sidecar${extension}`,
)
if (process.env.REDCODE_RPC_SIDECAR_TARGET) {
  process.env.SCRIPTC_TARGET = process.env.REDCODE_RPC_SIDECAR_TARGET
  process.env.SCRIPTC_CC = "zigcc"
}
await $`mkdir -p ${path.dirname(output)}`
await $`node ${path.resolve(import.meta.dir, "../node_modules/scriptc/dist/bootstrap.js")} build ${path.resolve(import.meta.dir, "../src/cli.ts")} --out ${output} --no-keep-c`
if (process.platform !== "win32" && !output.endsWith(".exe")) await $`chmod 755 ${output}`

console.log(output)
