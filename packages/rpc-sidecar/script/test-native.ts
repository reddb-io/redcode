#!/usr/bin/env bun

import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const extension = process.platform === "win32" ? ".exe" : ""
const output = path.join(root, `dist/redcode-rpc-sidecar${extension}`)
const build = Bun.spawn(["bun", "run", "build"], { cwd: root, stdout: "inherit", stderr: "inherit" })
if ((await build.exited) !== 0) process.exit(1)

const test = Bun.spawn(["bun", "test", "test/sidecar.test.ts"], {
  cwd: root,
  env: { ...process.env, REDCODE_RPC_SIDECAR_COMMAND: output },
  stdout: "inherit",
  stderr: "inherit",
})
process.exit(await test.exited)
