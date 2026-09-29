#!/usr/bin/env bun

// Smoke-tests a built Redcode binary through its real flows, in a fresh home, without model credentials:
// version and RPC sidecar, background service boot on a non-default port, a scripted session against a fake
// OpenAI-compatible provider (tool call, final text, stored token accounting), a `--tmp` worktree session,
// an optional Design review rendered in headless Chromium, and the failure reason of a port collision.
//
//   bun script/smoke/run.ts --binary <path> [--version <x.y.z>] [--design] [--design-bin <path>]
//     [--artifacts <dir>] [--keep]

import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { parseArgs } from "node:util"
import type { Browser, BrowserType } from "playwright-core"
import { FakeProvider } from "./fake-provider"

const NOTE_TEXT = "SMOKE-NOTE-4711"
const DESIGN_TEXT = "SMOKE-DESIGN-RENDERED"

const args = parseArgs({
  options: {
    binary: { type: "string" },
    version: { type: "string" },
    design: { type: "boolean", default: false },
    "design-bin": { type: "string" },
    artifacts: { type: "string" },
    keep: { type: "boolean", default: false },
  },
}).values
if (!args.binary) throw new Error("Usage: bun script/smoke/run.ts --binary <path> [--version <x.y.z>] [--design]")
const binary = path.resolve(args.binary)
if (!(await Bun.file(binary).exists())) throw new Error(`Missing Redcode binary: ${binary}`)

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "redcode-smoke-")))
const home = path.join(root, "home")
const tmp = path.join(root, "tmp")
const artifacts = path.resolve(args.artifacts ?? path.join(root, "artifacts"))
await Promise.all([home, tmp, artifacts].map((directory) => mkdir(directory, { recursive: true })))
const redcodeHome = path.join(home, ".red", "code")
const port = await freePort()
// A minimal environment keeps runner credentials and provider keys out of the smoke; TMPDIR is set before the
// service boots because the service owns the temporary directory that `--tmp` worktrees use.
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: home,
  USERPROFILE: home,
  TMPDIR: tmp,
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  XDG_STATE_HOME: path.join(home, ".local", "state"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Redcode Smoke",
  GIT_AUTHOR_EMAIL: "smoke@redcode.invalid",
  GIT_COMMITTER_NAME: "Redcode Smoke",
  GIT_COMMITTER_EMAIL: "smoke@redcode.invalid",
  REDCODE_NO_BROWSER: "1",
  REDCODE_DISABLE_AUTOUPDATE: "1",
  REDCODE_DISABLE_LSP_DOWNLOAD: "1",
  REDCODE_DISABLE_SHARE: "1",
  ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
  ...(args["design-bin"] ? { REDCODE_DESIGN_BIN: path.resolve(args["design-bin"]) } : {}),
}

const provider = FakeProvider.start({
  read: {
    calls: [{ name: "read", input: { path: path.join(root, "project", "note.txt") } }],
    text: "SMOKE-FINAL read",
  },
  worktree: {
    calls: [{ name: "worktree_prepare", input: { name: "smoke worktree" } }],
    text: "SMOKE-FINAL worktree",
  },
  design: {
    calls: [
      {
        name: "design_document",
        input: {
          action: "create",
          input: { name: "Smoke screen", journey: "new", engine: "html", kind: "screen", target: "web" },
        },
      },
      {
        name: "write",
        input: (results) => ({
          path: path.join(match(results[0], /^Root: (.+)$/m, "design root"), "index.html"),
          content: `<!doctype html><html><head><title>Smoke</title></head><body><h1>${DESIGN_TEXT}</h1></body></html>\n`,
        }),
      },
      {
        name: "design_preview",
        input: (results) => ({
          id: match(results[0], /\b(design_[a-zA-Z0-9_-]+)/, "design ID"),
          name: "Smoke screen",
        }),
      },
    ],
    text: "SMOKE-FINAL design",
  },
})

await configureProvider()
// A hand run stopped with Ctrl-C or `timeout` must not leave the detached service or Design app behind.
;["SIGINT", "SIGTERM"].forEach((signal) =>
  process.once(signal, () => {
    cleanup().finally(() => process.exit(130))
  }),
)

const checks = [
  { name: "version", run: checkVersion },
  { name: "service boot", run: checkService },
  { name: "rpc sidecar", run: checkSidecar },
  { name: "session with a tool call", run: checkSession },
  { name: "--tmp worktree", run: checkWorktree },
  ...(args.design ? [{ name: "design review", run: checkDesign }] : []),
  { name: "port collision reason", run: checkCollision },
]
const results: Array<{ name: string; seconds: number; error?: string }> = []
for (const check of checks) {
  const started = performance.now()
  const error = await check.run().then(
    () => undefined,
    (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  )
  const seconds = Math.round((performance.now() - started) / 100) / 10
  results.push({ name: check.name, seconds, error })
  const detail = error ? `\n     ${error.replaceAll("\n", "\n     ")}` : ""
  console.log(`${error ? "FAIL" : "ok  "} ${check.name} (${seconds}s)${detail}`)
}

await cleanup()
const failed = results.filter((result) => result.error !== undefined)
await Bun.write(path.join(artifacts, "results.json"), JSON.stringify(results, null, 2))
if (failed.length > 0) {
  console.error(
    `${failed.length} of ${results.length} smoke checks failed: ${failed.map((item) => item.name).join(", ")}`,
  )
  process.exit(1)
}
console.log(`All ${results.length} smoke checks passed`)

async function checkVersion() {
  const output = (await redcode(["--version"])).stdout.trim()
  const expected = args.version ? `redcode v${args.version}` : undefined
  if (expected ? output !== expected : !/^redcode v\d+\.\d+\.\d+/.test(output))
    throw new Error(`--version printed ${JSON.stringify(output)}${expected ? `, expected ${expected}` : ""}`)
}

async function checkService() {
  await redcode(["service", "set", "port", String(port)])
  const started = performance.now()
  await redcode(["service", "start"], { timeout: 60_000 })
  console.log(`     background service started in ${Math.round(performance.now() - started)}ms`)
  const status = (await redcode(["service", "status"])).stdout.trim()
  if (status !== `http://127.0.0.1:${port}`) throw new Error(`service status printed ${JSON.stringify(status)}`)
  const service = await registration()
  const response = await fetch(new URL("/api/info", service.url), {
    headers: { authorization: `Basic ${btoa(`opencode:${service.password}`)}` },
    signal: AbortSignal.timeout(5_000),
  })
  // The info route answers 200 only once the service state is ready; starting is 503 and failed is 500.
  if (response.status !== 200) throw new Error(`/api/info answered HTTP ${response.status}: ${await response.text()}`)
  const info: unknown = await response.json()
  if (args.version && field(info, "version") !== args.version)
    throw new Error(`The service reports version ${String(field(info, "version"))}`)
}

async function checkSidecar() {
  const sidecar = path.join(path.dirname(binary), `redcode-rpc-sidecar${process.platform === "win32" ? ".exe" : ""}`)
  if (!(await Bun.file(sidecar).exists())) throw new Error(`Missing RPC sidecar next to the binary: ${sidecar}`)
  const service = await registration()
  const body = JSON.stringify({ jsonrpc: "2.0", method: "health.get", id: 1 })
  const child = Bun.spawn([sidecar], {
    env: {
      ...env,
      REDCODE_RPC_URL: new URL("/rpc", service.url).href,
      REDCODE_SERVER_USERNAME: "opencode",
      REDCODE_SERVER_PASSWORD: service.password,
    },
    stdin: new TextEncoder().encode(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0 || !stdout.includes('"healthy":true'))
    throw new Error(`The sidecar exited ${code} with ${JSON.stringify(stdout)} ${stderr}`)
}

async function checkSession() {
  const project = path.join(root, "project")
  await Bun.write(path.join(project, "note.txt"), `${NOTE_TEXT}\n`)
  const events = await session(project, "smoke:read Read note.txt and report what it says.")
  const tool = events.find((event) => event.type === "tool_use" && field(event.part, "tool") === "read")
  const state = field(tool?.part, "state")
  if (field(state, "status") !== "completed" || !String(field(state, "output")).includes(NOTE_TEXT))
    throw new Error(`The read tool did not complete with the note: ${JSON.stringify(state)}`)
  expectFinalText(events, "SMOKE-FINAL read")
  const sessionID = String(field(events[0], "sessionID"))
  const service = await registration()
  const response = await fetch(new URL(`/api/session/${sessionID}/message`, service.url), {
    headers: { authorization: `Basic ${btoa(`opencode:${service.password}`)}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Reading the stored session answered HTTP ${response.status}`)
  const messages: unknown = await response.json()
  await Bun.write(path.join(artifacts, "session-read-messages.json"), JSON.stringify(messages, null, 2))
  // The fake provider counts reasoning apart from completion; the stored output must not collapse to zero.
  const outputs = collect(messages, "tokens").map((tokens) => field(tokens, "output"))
  if (!outputs.some((value) => typeof value === "number" && value > 0))
    throw new Error(`The stored session has no non-zero output token count: ${JSON.stringify(outputs)}`)
}

async function checkWorktree() {
  const repository = path.join(root, "repository")
  await mkdir(repository)
  await git(repository, ["init", "--quiet", "--initial-branch", "main"])
  await Bun.write(path.join(repository, "README.md"), "smoke\n")
  await git(repository, ["add", "README.md"])
  await git(repository, ["commit", "--quiet", "--message", "init"])
  const events = await session(repository, "smoke:worktree Prepare a worktree.", { flags: ["--tmp"] })
  const tool = events.find((event) => event.type === "tool_use" && field(event.part, "tool") === "worktree_prepare")
  const state = field(tool?.part, "state")
  const directory = field(field(field(state, "metadata"), "metadata"), "directory")
  if (field(state, "status") !== "completed" || typeof directory !== "string")
    throw new Error(`worktree_prepare did not complete with a directory: ${JSON.stringify(state)}`)
  const expected = path.join(tmp, "redcode-worktrees") + path.sep
  if (!directory.startsWith(expected)) throw new Error(`The --tmp worktree ${directory} is not under ${expected}`)
  const common = (await git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim()
  if (common !== path.join(repository, ".git")) throw new Error(`${directory} is not a worktree of ${repository}`)
  if (await Bun.file(path.join(repository, ".red", "worktrees")).exists())
    throw new Error("--tmp still created .red/worktrees in the repository")
  expectFinalText(events, "SMOKE-FINAL worktree")
}

async function checkDesign() {
  const project = path.join(root, "design")
  await mkdir(project)
  // Design may download its app on first use unless --design-bin points at a local build.
  const events = await session(project, "smoke:design Design a smoke screen.", {
    flags: ["--agent", "design"],
    timeout: 240_000,
  })
  const tool = events.find((event) => event.type === "tool_use" && field(event.part, "tool") === "design_preview")
  const state = field(tool?.part, "state")
  if (field(state, "status") !== "completed")
    throw new Error(`design_preview did not complete: ${JSON.stringify(state)}`)
  const review = match(String(field(state, "output")), /^Review: (\S+)$/m, "review link")
  // Playwright lives with @opencode/core, which renders designs with the same headless Chromium.
  const { chromium }: { chromium: BrowserType } = await import(
    Bun.resolveSync("playwright-core", path.join(import.meta.dir, "..", "..", "packages", "core"))
  )
  const browser = await chromium.launch({ headless: true })
  await renderReview(browser, review).finally(() => browser.close())
  expectFinalText(events, "SMOKE-FINAL design")
}

// The review link carries a ticket, so only the browser loads it.
async function renderReview(browser: Browser, review: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors: Array<string> = []
  page.on("pageerror", (error) => errors.push(`page error: ${error.message}`))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`)
  })
  page.on("requestfailed", (request) => errors.push(`request failed: ${request.url()} ${request.failure()?.errorText}`))
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  const response = await page.goto(review, { waitUntil: "networkidle", timeout: 60_000 })
  if (!response?.ok()) throw new Error(`The review link answered HTTP ${response?.status()}`)
  // A web UI in front of the server once answered Design routes with its own index page, which looks blank here.
  if ((await page.locator("#review").count()) === 0)
    throw new Error(
      `The review link served ${JSON.stringify(await page.title())} instead of the Design review page\n${errors.slice(0, 5).join("\n")}`,
    )
  const deadline = Date.now() + 30_000
  const rendered = async () => {
    const texts = await Promise.all(
      page.frames().map((frame) =>
        frame
          .locator("body")
          .innerText()
          .catch(() => ""),
      ),
    )
    return texts.some((text) => text.includes(DESIGN_TEXT))
  }
  while (!(await rendered()) && Date.now() < deadline) await Bun.sleep(250)
  await page.screenshot({ path: path.join(artifacts, "design-review.png"), fullPage: true })
  if (await rendered()) return
  const frames = page.frames().map((frame) => frame.url())
  const html = (await page.content()).slice(0, 1_500)
  await Bun.write(path.join(artifacts, "design-review.html"), await page.content())
  throw new Error(
    [
      `The review page never showed the published revision (at ${page.url()}, frames ${frames.join(", ")})`,
      ...errors,
      html,
    ].join("\n"),
  )
}

async function checkCollision() {
  await redcode(["service", "stop"], { timeout: 30_000 })
  const blocker = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } })
  // Recognizing a foreign listener takes the server about 15 seconds before it reports the collision.
  const result = await redcode(["service", "start"], { timeout: 60_000, check: false }).finally(() =>
    blocker.stop(true),
  )
  const output = result.stdout + result.stderr
  if (result.code === 0) throw new Error(`service start succeeded on a taken port:\n${output}`)
  const expected = [`Managed service port ${port}`, "already in use", "redcode service set port"]
  const missing = expected.filter((text) => !output.includes(text))
  if (missing.length > 0)
    throw new Error(`service start did not explain the collision (missing ${missing.join(", ")}):\n${output}`)
}

async function session(
  directory: string,
  prompt: string,
  options: { readonly flags?: ReadonlyArray<string>; readonly timeout?: number } = {},
) {
  const scenario = match(prompt, /^smoke:([a-z0-9-]+)/, "scenario")
  const result = await redcode(
    ["run", "--model", `smoke/${FakeProvider.MODEL}`, "--format", "json", "--auto", ...(options.flags ?? []), prompt],
    { cwd: directory, timeout: options.timeout ?? 120_000 },
  )
  await Bun.write(path.join(artifacts, `session-${scenario}.jsonl`), result.stdout)
  return result.stdout
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line): Record<string, unknown> => JSON.parse(line))
}

function expectFinalText(events: ReadonlyArray<Record<string, unknown>>, expected: string) {
  if (!events.some((event) => event.type === "text" && field(event.part, "text") === expected))
    throw new Error(`The session did not end with ${JSON.stringify(expected)}`)
}

// Writes the provider the way the `/connect` OpenAI-compatible wizard does: `providers.<id>` in the global
// configuration, before the service boots. The key sits in settings because this endpoint accepts any key.
async function configureProvider() {
  await Bun.write(
    path.join(redcodeHome, "config.json"),
    JSON.stringify(
      {
        providers: {
          smoke: {
            name: "Smoke",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: provider.url, provider: "smoke", apiKey: "smoke-key" },
            models: { [FakeProvider.MODEL]: { name: "Smoke model", limit: { context: 128_000, output: 8_192 } } },
          },
        },
      },
      null,
      2,
    ),
  )
}

async function redcode(
  command: ReadonlyArray<string>,
  options: { readonly cwd?: string; readonly timeout?: number; readonly check?: boolean } = {},
) {
  const child = Bun.spawn([binary, ...command], {
    cwd: options.cwd ?? root,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeout ?? 30_000,
    killSignal: "SIGKILL",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (options.check !== false && code !== 0)
    throw new Error(`redcode ${command.join(" ")} exited ${code ?? child.signalCode}\n${stdout}${stderr}`.trim())
  return { code, stdout, stderr }
}

async function git(cwd: string, command: ReadonlyArray<string>) {
  const child = Bun.spawn(["git", ...command], { cwd, env, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`git ${command.join(" ")} exited ${code}: ${stderr}`)
  return stdout
}

async function registration() {
  const info: unknown = await Bun.file(path.join(redcodeHome, "state", "service.json")).json()
  const url = field(info, "url")
  const password = field(info, "password")
  if (typeof url !== "string" || typeof password !== "string") throw new Error("The service registration is incomplete")
  return { url, password }
}

// Stops everything this run started: the service and a detached Design app outlive their clients by design.
async function cleanup() {
  provider.stop()
  await redcode(["service", "stop"], { check: false })
  const pids = await Promise.all(
    ["service.json", "design.json"].map((file) =>
      Bun.file(path.join(redcodeHome, "state", file))
        .json()
        .then((info: unknown) => field(info, "pid"))
        .catch(() => undefined),
    ),
  )
  pids.filter((pid) => typeof pid === "number").forEach(kill)
  const log = Bun.file(path.join(redcodeHome, "data", "log", "opencode.log"))
  if (await log.exists()) await Bun.write(path.join(artifacts, "redcode.log"), log)
  const designLog = Bun.file(path.join(redcodeHome, "state", "design-app.log"))
  if (await designLog.exists()) await Bun.write(path.join(artifacts, "design-app.log"), designLog)
  if (!args.keep) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  if (args.keep) console.log(`Kept ${root}`)
}

function kill(pid: number) {
  // The process may already have exited, which is the outcome this wants.
  try {
    process.kill(pid, "SIGKILL")
  } catch {}
}

async function freePort() {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const value = probe.port
  probe.stop(true)
  return value
}

function match(text: string | undefined, pattern: RegExp, label: string) {
  const found = pattern.exec(text ?? "")?.[1]
  if (!found) throw new Error(`Could not find the ${label} in ${JSON.stringify(text)}`)
  return found
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function collect(value: unknown, key: string): Array<unknown> {
  if (Array.isArray(value)) return value.flatMap((item) => collect(item, key))
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([name, item]) =>
    name === key ? [item, ...collect(item, key)] : collect(item, key),
  )
}
