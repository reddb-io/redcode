// IMPORTANT: these run before any import from src/, because `src/global.ts` resolves the app home
// at module scope. Without REDCODE_TEST_HOME it resolves to the developer's — or the runner's —
// real `~/.red/code`, and then creates directories in it, shares a `cache/bin` across
// concurrent jobs, and lets an ambient `~/.npmrc` reach the installer under test.
import os from "os"
import path from "path"
import fs from "fs/promises"
import { appendFileSync } from "fs"
import { afterAll, afterEach, beforeEach } from "bun:test"
import { removeOnExit, removeTempPaths, sharePlaywrightBrowsers } from "./fixture/temp-root"

// Set by script/test-ci.ts only: every worker notes each file it starts and finishes, so a stalled CI
// run can name the file it is stuck in. `Bun.main` is the test file, since each file re-runs this.
const progress = process.env.REDCODE_TEST_PROGRESS
if (progress) {
  const log = path.join(progress, String(process.pid))
  appendFileSync(log, `start ${Date.now()} ${Bun.main}\n`)
  // Tests are numbered in run order: a stall names the test it is in, or none when the file
  // never finished loading.
  let count = 0
  beforeEach(() => appendFileSync(log, `test ${Date.now()} #${++count} started\n`))
  afterEach(() => appendFileSync(log, `test ${Date.now()} #${count} finished\n`))
  afterAll(() => appendFileSync(log, `end ${Date.now()} ${Bun.main}\n`))
}

// Before HOME and XDG_CACHE_HOME are repointed below, or every run downloads its own Chromium.
sharePlaywrightBrowsers()

const dir = path.join(os.tmpdir(), "redcode-core-test-" + process.pid)
// Per process, so it goes when the process does: after the last file, or on an interrupt.
removeOnExit(dir)
afterAll(() => removeTempPaths([dir]))
// The home is per process: CI runs core files in parallel processes, and a shared home let one
// process's intelligence.json, KV state and data leak into another. Only `Global.Path.bin` is shared
// (linked below), because that is where ripgrep lands when the machine has none on PATH and a
// per-process bin would download it again for every process.
const home = path.join(dir, "home")
const bin = path.join(os.tmpdir(), "redcode-core-test-bin")
const cache = path.join(home, ".red", "code", "cache")
await fs.mkdir(bin, { recursive: true })
await fs.mkdir(cache, { recursive: true })
await fs.symlink(bin, path.join(cache, "bin"), process.platform === "win32" ? "junction" : "dir").catch((error) => {
  // Each file re-runs this preload in the same process, so the link is usually already there.
  if (error?.code !== "EEXIST") throw error
})

process.env.REDCODE_TEST_HOME = home
process.env.HOME = home
process.env.XDG_DATA_HOME = path.join(dir, "share")
process.env.XDG_CACHE_HOME = path.join(dir, "cache")
process.env.XDG_CONFIG_HOME = path.join(dir, "config")
process.env.XDG_STATE_HOME = path.join(dir, "state")

process.env.REDCODE_DB = ":memory:"
process.env.REDCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.REDCODE_DISABLE_MODELS_FETCH = "true"
// The installer under test must never reach npm's audit endpoint.
process.env.NPM_CONFIG_AUDIT = "false"
// No suite may launch the developer's browser for a Design review; launcher tests inject fakes.
process.env.REDCODE_DESIGN_NO_OPEN = "1"
process.env.REDCODE_NO_BROWSER = "1"

// A key left in the runner's environment changes which providers exist, which is not something a
// unit suite should be able to notice.
for (const key of [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_BEARER_TOKEN_BEDROCK",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "XAI_API_KEY",
  "REDCODE_SERVER_PASSWORD",
  "REDCODE_SERVER_USERNAME",
  "REDCODE_EXPERIMENTAL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
]) {
  delete process.env[key]
}
