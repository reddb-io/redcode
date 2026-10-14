import { beforeAll, afterAll, expect, setSystemTime, test } from "bun:test"
import path from "node:path"
import { createServer } from "node:http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { Scope, type IpcImpl, type MainContext } from "../src/sdk/main"
import { Ssh, type SshConfig } from "../src/ssh/contract"
import type definition from "../src/ssh/index"
import setup from "../src/ssh/main"

let tools: Awaited<ReturnType<typeof tmpdir>>
beforeAll(async () => {
  tools = await tmpdir()
  const source = path.join(tools.path, "ssh.ts")
  await Bun.write(
    source,
    `
import net from "node:net"
const args = process.argv.slice(2)
const root = ${JSON.stringify(tools.path)}
await Bun.write(root + "/calls", (await Bun.file(root + "/calls").text().catch(() => "")) + JSON.stringify(args) + "\\n")
if (args.includes("-G")) { console.log("hostname fixture\\nuser fixture\\nport 22"); process.exit(0) }
if (args.includes("-O")) process.exit(0)
if (args.includes("-L")) {
  const forward = args[args.indexOf("-L") + 1].split(":")
  const server = net.createServer(socket => {
    const remote = net.connect({host:forward[2],port:Number(forward[3])})
    socket.pipe(remote).pipe(socket)
    remote.on("error", () => socket.destroy())
    socket.on("error", () => remote.destroy())
  })
  await new Promise(resolve => server.listen(Number(forward[1]), forward[0], resolve))
  await Bun.write(root + "/tunnel", String(process.pid))
  setInterval(async () => {
    const killed = await Bun.file(root + "/kill").text().catch(() => "")
    if (killed === String(process.pid)) process.exit(255)
  }, 10)
} else if (args.includes("sh -l -s")) {
  await new Response(Bun.stdin.stream()).text()
  const file = root + "/discoveries"
  const previous = await Bun.file(file).text().catch(() => "")
  await Bun.write(file, previous + process.pid + "\\n")
  while (await Bun.file(root + "/allow").text().catch(() => "") !== "yes") await Bun.sleep(10)
  const registration = {url:await Bun.file(root + "/endpoint").text(),password:"fixture-private",version:"0.81.1",pid:42}
  console.log("OPENCODE_SSH_STATUS=" + registration.url + "\\nOPENCODE_SSH_REGISTRATION_BEGIN\\n" + JSON.stringify(registration) + "\\nOPENCODE_SSH_REGISTRATION_END")
  process.exit(0)
} else process.exit(0)
`,
  )
  const result = await Bun.build({
    entrypoints: [source],
    compile: { outfile: path.join(tools.path, process.platform === "win32" ? "ssh.exe" : "ssh") },
  })
  expect(result.success).toBe(true)
}, 30_000)

test("a stable SSH tunnel restores the automatic retry budget", async () => {
  await using ctx = await fixture()
  await ctx.allow()
  await ctx.api.start(ctx.config, ctx.caller(1))
  try {
    for (let cycle = 1; cycle <= 5; cycle++) {
      await until(() => ctx.state()?.stage === "ready")
      if (cycle === 5) setSystemTime(new Date(Date.now() + 61_000))
      await ctx.kill()
      await until(() => ctx.state()?.stage === "failed")
      setSystemTime(new Date(Date.now() + 61_000))
      expect(await ctx.api.resolve({ id: "fixture" }, ctx.caller(2))).not.toBeNull()
    }
    expect(await ctx.discoveries()).toBe(6)
  } finally {
    setSystemTime()
  }
}, 30_000)
afterAll(async () => tools?.[Symbol.asyncDispose]())

function unexpected(): never {
  throw new Error("Unexpected host operation")
}

async function fixture() {
  const root = tools
  const originalPath = process.env.PATH
  let probes = 0
  let rejectProbe = false
  let probeDelay = 0
  const server = createServer((_req, response) => {
    probes++
    response.statusCode = rejectProbe ? 503 : 200
    rejectProbe = false
    response.setHeader("content-type", "application/json")
    const timer = setTimeout(() => response.end(JSON.stringify({ version: "0.81.1" })), probeDelay)
    probeDelay = 0
    response.once("close", () => clearTimeout(timer))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (typeof address === "string" || address === null) return unexpected()
  process.env.PATH = `${tools.path}${path.delimiter}${originalPath}`
  await Promise.all([
    Bun.write(path.join(root.path, "endpoint"), `http://127.0.0.1:${address.port}`),
    ...["discoveries", "calls", "kill", "allow"].map((file) => Bun.write(path.join(root.path, file), "")),
  ])
  const scope = Scope.make("ssh-test", { timeout: 5000, log: (message, data) => console.error(message, data) })
  let saved: readonly SshConfig[] = []
  let provided: IpcImpl<typeof Ssh.spec> | undefined
  const ctx: MainContext<typeof definition> = {
    id: "ssh",
    scope,
    add: unexpected,
    list: unexpected,
    t: (key) => key,
    plural: unexpected,
    stores: {
      servers: {
        get value() {
          return saved
        },
        ready: () => true,
        update: unexpected,
        set: (next) => {
          saved = next
        },
      },
    },
    storage: { store: unexpected, remove: unexpected },
    log: { write: unexpected },
    lifecycle: { restart: unexpected },
    build: { version: "0.81.1", channel: "prod", platform: "desktop", packaged: true },
    serverEndpoints: { get: unexpected },
    windows: { get: unexpected, list: unexpected, focused: unexpected, on: () => () => {} },
    embeds: { create: unexpected },
    cli: {
      version: "0.81.1",
      command: [process.execPath],
      binary: process.execPath,
      development: false,
      installed: true,
    },
    provide(token, impl) {
      if (token !== Ssh) return unexpected()
      // SAFETY: this host accepts only the exact Ssh token, which owns this implementation's spec.
      provided = impl as unknown as IpcImpl<typeof Ssh.spec>
      return { changed: () => {}, emit: unexpected, dispose: () => {} }
    },
  }
  await setup(ctx)
  if (!provided) return unexpected()
  const api = provided
  const config = { id: "fixture", target: "user@fixture", name: "Fixture" }
  const caller = (window: number) => ({ window, signal: scope.signal })
  const state = () => api.state(1).servers.find((item) => item.config.id === config.id)
  const discoveries = async () =>
    (
      await Bun.file(path.join(root.path, "discoveries"))
        .text()
        .catch(() => "")
    )
      .trim()
      .split("\n")
      .filter(Boolean).length
  return {
    api,
    config,
    caller,
    state,
    discoveries,
    probes: () => probes,
    rejectProbe: () => {
      rejectProbe = true
    },
    delayProbe: () => {
      probeDelay = 3000
    },
    allow: () => Bun.write(path.join(root.path, "allow"), "yes"),
    kill: async () => Bun.write(path.join(root.path, "kill"), await Bun.file(path.join(root.path, "tunnel")).text()),
    async [Symbol.asyncDispose]() {
      await scope.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      process.env.PATH = originalPath
      setSystemTime()
    },
  }
}

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = performance.now() + 5000
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error("SSH fixture timed out")
    await Bun.sleep(10)
  }
}

test("SSH IPC joins background restores from multiple windows without replacing the tunnel", async () => {
  await using ctx = await fixture()
  await ctx.api.start({ ...ctx.config, background: true }, ctx.caller(1))
  await until(async () => (await ctx.discoveries()) === 1)
  await ctx.api.start({ ...ctx.config, background: true }, ctx.caller(2))
  await Bun.sleep(150)
  expect(await ctx.discoveries()).toBe(1)
  await ctx.allow()
  const [first, second] = await Promise.all([
    ctx.api.resolve({ id: "fixture" }, ctx.caller(1)),
    ctx.api.resolve({ id: "fixture" }, ctx.caller(2)),
  ])
  expect(first).toEqual(second)
  expect(first).not.toBeNull()
  expect(await ctx.discoveries()).toBe(1)
  await ctx.api.start({ ...ctx.config, background: true }, ctx.caller(3))
  await Bun.sleep(150)
  expect(await ctx.discoveries()).toBe(1)
  expect(ctx.state()?.stage).toBe("ready")
  const before = ctx.probes()
  await Promise.all([
    ctx.api.resolve({ id: "fixture" }, ctx.caller(1)),
    ctx.api.resolve({ id: "fixture" }, ctx.caller(2)),
  ])
  expect(ctx.probes() - before).toBe(1)
}, 15_000)

test("a slow shared SSH probe survives one window cancelling its request", async () => {
  await using ctx = await fixture()
  await ctx.allow()
  await ctx.api.start(ctx.config, ctx.caller(1))
  await until(() => ctx.state()?.stage === "ready")
  const before = ctx.probes()
  ctx.delayProbe()
  const closing = new AbortController()
  const first = Promise.resolve(ctx.api.resolve({ id: "fixture" }, { window: 1, signal: closing.signal })).then(
    () => "resolved",
    () => "cancelled",
  )
  await until(() => ctx.probes() > before)
  const second = ctx.api.resolve({ id: "fixture" }, ctx.caller(2))
  closing.abort()
  expect(await first).toBe("cancelled")
  expect(await second).not.toBeNull()
  expect(ctx.probes() - before).toBe(1)
  expect(ctx.state()?.stage).toBe("ready")
  expect(await ctx.discoveries()).toBe(1)
}, 15_000)

test.each(["exit", "probe"] as const)(
  "SSH IPC backs off repeated %s failures and pauses until manual retry",
  async (failure) => {
    await using ctx = await fixture()
    await ctx.allow()
    await ctx.api.start(ctx.config, ctx.caller(1))
    try {
      for (let cycle = 1; cycle <= 5; cycle++) {
        await until(() => ctx.state()?.stage === "ready")
        expect(await ctx.discoveries()).toBe(cycle)
        if (failure === "exit") await ctx.kill()
        else {
          ctx.rejectProbe()
          expect(
            await Promise.all([
              ctx.api.resolve({ id: "fixture" }, ctx.caller(1)),
              ctx.api.resolve({ id: "fixture" }, ctx.caller(2)),
            ]),
          ).toEqual([null, null])
        }
        await until(() => ctx.state()?.stage === "failed")
        expect(await ctx.api.resolve({ id: "fixture" }, ctx.caller(2))).toBeNull()
        expect(await ctx.discoveries()).toBe(cycle)
        setSystemTime(new Date(Date.now() + 61_000))
        if (cycle < 5) expect(await ctx.api.resolve({ id: "fixture" }, ctx.caller(2))).not.toBeNull()
      }
      expect(await ctx.api.resolve({ id: "fixture" }, ctx.caller(2))).toBeNull()
      await ctx.api.start({ ...ctx.config, background: true }, ctx.caller(3))
      expect(await ctx.discoveries()).toBe(5)
      await ctx.api.start(ctx.config, ctx.caller(1))
      await until(() => ctx.state()?.stage === "ready")
      expect(await ctx.discoveries()).toBe(6)
    } finally {
      setSystemTime()
    }
  },
  30_000,
)
