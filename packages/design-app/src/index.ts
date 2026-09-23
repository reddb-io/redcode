#!/usr/bin/env bun
import path from "node:path"
import { parseArgs } from "node:util"

const usage = `Usage: redcode-design serve --host-url <redcode server> [options]

Serves Design's review surface and runs its builds, renders and exports for redcode.

Options:
  --host-url <url>        redcode server whose design.host routes serve the conversations
  --token-file <path>     shared token file (default: <state>/design.token)
  --state <directory>     where the registration and token live (default: redcode's state directory)
  --register              record this app in <state>/design.json for redcode to find
  --hostname <name>       interface to listen on (default: 127.0.0.1)
  --port <number>         port to listen on (default: any free port)
  --idle-minutes <number> exit after this long without review tabs, requests or jobs (default: 10)`

const parsed = parseArgs({
  allowPositionals: true,
  options: {
    "host-url": { type: "string" },
    "token-file": { type: "string" },
    state: { type: "string" },
    register: { type: "boolean", default: false },
    hostname: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "0" },
    "idle-minutes": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (parsed.values.help || parsed.positionals[0] !== "serve" || !parsed.values["host-url"]) {
  console.error(usage)
  process.exit(parsed.values.help ? 0 : 1)
}

const { Global } = await import("@reddb-io/redcode-core/global")
const { DesignApp } = await import("@reddb-io/redcode-core/design/app")
const { DesignAppServer } = await import("./server")
const state = path.resolve(parsed.values.state ?? Global.Path.state)
const minutes = Number(parsed.values["idle-minutes"] ?? DesignApp.IDLE_MINUTES)
const app = await DesignAppServer.start({
  host: parsed.values["host-url"],
  token: await DesignApp.token(parsed.values["token-file"] ?? DesignApp.paths(state).token),
  state,
  register: parsed.values.register,
  hostname: parsed.values.hostname,
  port: Number(parsed.values.port),
  idle: (Number.isFinite(minutes) && minutes > 0 ? minutes : DesignApp.IDLE_MINUTES) * 60_000,
})
console.error(`redcode-design listening on ${app.url}`)
