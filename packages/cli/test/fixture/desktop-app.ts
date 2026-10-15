import { existsSync, writeSync } from "node:fs"
import path from "node:path"

if (process.env.REDCODE_DESKTOP_FIXTURE_SESSION) {
  process.stdout.write(process.env.REDCODE_DESKTOP_FIXTURE_SESSION)
  process.exit(0)
}

const mode = process.env.REDCODE_DESKTOP_FIXTURE_MODE
if (mode === "crash") {
  writeSync(2, "desktop startup fixture failed\n")
  process.exit(23)
}
if (mode === "large-error") {
  writeSync(2, `first diagnostic\n${"x".repeat(20_000)}\nlast startup diagnostic\n`)
  process.exit(24)
}
if (mode === "signal") process.kill(process.pid, "SIGTERM")
if (mode === "handoff") process.exit(0)
if (mode === "running") {
  const state = process.env.REDCODE_DESKTOP_FIXTURE_STATE!
  await Bun.write(state, JSON.stringify({ pid: process.pid, cli: process.env.REDCODE_DESKTOP_CLI }))
  const timer = setInterval(() => {
    if (!existsSync(path.join(path.dirname(state), "write"))) return
    writeSync(2, "still writable\n")
    clearInterval(timer)
  }, 20)
  setInterval(() => {}, 1000)
}
