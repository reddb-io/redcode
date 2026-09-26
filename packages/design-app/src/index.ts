#!/usr/bin/env bun

import path from "node:path"
import { parseArgs } from "node:util"
import { DesignApp } from "@opencode/core/design/app"
import { Database } from "@opencode/core/database/database"
import { Global } from "@opencode/util/global"
import pkg from "../package.json"

declare const REDCODE_DESIGN_APP_VERSION: string | undefined

const version = typeof REDCODE_DESIGN_APP_VERSION === "string" ? REDCODE_DESIGN_APP_VERSION : pkg.version
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
    version: { type: "boolean", short: "v", default: false },
    protocol: { type: "boolean", default: false },
  },
})

if (parsed.values.version || parsed.values.protocol) {
  console.log(parsed.values.version ? version : DesignApp.PROTOCOL)
  process.exit(0)
}

if (parsed.values.help || parsed.positionals[0] !== "serve" || !parsed.values["host-url"]) {
  console.error("Usage: redcode-design serve --host-url <redcode server> [--state <directory>] [--register]")
  process.exit(parsed.values.help ? 0 : 1)
}

const database = process.env.OPENCODE_DB
const databaseURL = process.env.REDCODE_DATABASE_URL
const selectedDatabase = databaseURL
  ? { url: Database.validateURL(databaseURL), token: process.env.REDCODE_DATABASE_TOKEN }
  : database && database !== ":memory:" && path.isAbsolute(database)
    ? { path: database }
    : undefined
if (!selectedDatabase)
  throw new Error("The design app needs the owning redcode server's database path or RedDB URL")

const { DesignAppServer } = await import("./server.js")
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
  database: selectedDatabase,
  version,
})
console.error(`redcode-design listening on ${app.url}`)
