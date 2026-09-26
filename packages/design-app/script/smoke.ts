#!/usr/bin/env bun

import path from "node:path"
import os from "node:os"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { Option, Schema } from "effect"
import { DesignApp } from "@opencode/core/design/app"

const binary = process.argv[2]
if (!binary) throw new Error("Usage: bun script/smoke.ts <compiled-design-app>")

const directory = await mkdtemp(path.join(os.tmpdir(), "redcode-design-smoke-"))
const state = path.join(directory, "state")
const token = "design-smoke-token"
await mkdir(state)
await Bun.write(path.join(state, "design.token"), token)
const child = Bun.spawn(
  [
    path.resolve(binary),
    "serve",
    "--register",
    "--host-url",
    "http://127.0.0.1:1",
    "--state",
    state,
    "--token-file",
    path.join(state, "design.token"),
  ],
  {
    env: { ...process.env, OPENCODE_DB: path.join(directory, "design.sqlite") },
    stdout: "inherit",
    stderr: "inherit",
  },
)

try {
  const registration = path.join(state, "design.json")
  const deadline = Date.now() + 30_000
  let url: string | undefined
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Design app exited before registration: ${child.exitCode}`)
    const info = Option.getOrUndefined(
      Schema.decodeUnknownOption(DesignApp.Registration)(await Bun.file(registration).json().catch(() => undefined)),
    )
    if (info?.pid === child.pid) {
      url = info.url
      break
    }
    await Bun.sleep(100)
  }
  if (!url) throw new Error("Design app did not register within 30 seconds")

  const headers = { authorization: `Bearer ${token}` }
  const health = await fetch(new URL("/app/health", url), { headers })
  if (!health.ok) throw new Error(`Design app health returned HTTP ${health.status}`)
  const answer = Option.getOrUndefined(Schema.decodeUnknownOption(DesignApp.Health)(await health.json()))
  if (!answer || answer.protocol !== DesignApp.PROTOCOL || answer.pid !== child.pid)
    throw new Error(`Design app returned invalid health: ${JSON.stringify(answer)}`)

  const unauthorized = await fetch(new URL("/app/vendor/daisyui.css", url))
  if (unauthorized.status !== 401) throw new Error(`Unauthenticated vendor request returned ${unauthorized.status}`)
  const asset = await fetch(new URL("/app/vendor/daisyui.css", url), { headers })
  if (!asset.ok || (await asset.text()).length < 1_000)
    throw new Error(`Design app did not serve the legacy vendor asset: HTTP ${asset.status}`)
  console.log("Design app started with the V2 database and served authenticated legacy assets")
} finally {
  if (child.exitCode === null) child.kill()
  await child.exited
  await rm(directory, { recursive: true, force: true })
}
