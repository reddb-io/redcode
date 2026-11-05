import { expect, test } from "bun:test"
import { EmbeddedTerminalRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test("a terminal reconnects to the same process and restores its latest snapshot", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const session = {
    id: "ses_reconnect",
    title: "Reconnect fixture",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const pty = {
    id: "pty_reconnect",
    sessionID: session.id,
    title: "Terminal",
    command: "shell",
    args: [],
    cwd: directory,
    status: "running",
    pid: 42,
    foregroundProcess: null,
    size: { cols: 48, rows: 24 },
    output: { head: 0, tail: 0 },
  }
  let snapshot = "before disconnect"
  let connections = 0
  let first: import("bun").ServerWebSocket<unknown> | undefined
  const input: string[] = []
  const calls = createFetch((url, request) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
    if (["inbox", "permission", "todo"].some((part) => url.pathname === `/api/session/${session.id}/${part}`))
      return json({ data: [] })
    if (url.pathname === `/api/experimental/session/${session.id}/terminal`)
      return json({ data: request.method === "POST" ? pty : [pty] })
    if (url.pathname === `/api/experimental/persistent-pty/${pty.id}/snapshot`)
      return json({
        data: {
          info: pty,
          text: snapshot,
          checkpoint: Buffer.from(snapshot).toString("base64"),
          cursor: { x: 0, y: 0 },
        },
      })
    if (url.pathname === `/api/experimental/persistent-pty/${pty.id}/connect-token`)
      return json({ data: { ticket: "fixture" } })
    return undefined
  }, createEventStream())
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname.endsWith("/connect") && server.upgrade(request)) return undefined
      return calls.fetch(request)
    },
    websocket: {
      open(socket) {
        connections++
        first ??= socket
        socket.send(JSON.stringify({ type: "attached", inputProtocol: 1, role: "controller", info: pty }))
        socket.send(JSON.stringify({ type: "replay_complete" }))
      },
      message(_socket, message) {
        const bytes = Buffer.from(message)
        if (bytes[0] === 1) input.push(bytes.subarray(5).toString())
      },
    },
  })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes("commands"))
    await setup.mockInput.typeText("/terminal")
    await setup.waitForFrame((frame) => frame.includes("New terminal"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("before disconnect"))
    expect(connections).toBe(1)
    setup.mockInput.pressKey("x", { ctrl: true })
    setup.mockInput.pressArrow("right")
    expect(setup.renderer.currentFocusedRenderable).toBeInstanceOf(EmbeddedTerminalRenderable)
    snapshot = "after reconnect"
    first?.close(4000, "simulated network interruption")
    await Bun.sleep(80)
    await setup.mockInput.typeText("queued")
    const deadline = Date.now() + 8_000
    while (connections < 2 || !setup.captureCharFrame().includes("after reconnect")) {
      if (Date.now() > deadline) throw new Error("terminal did not reconnect and restore its screen")
      await Bun.sleep(30)
    }
    expect(setup.renderer.currentFocusedRenderable).toBeInstanceOf(EmbeddedTerminalRenderable)
    await setup.mockInput.typeText("hello")
    while (!input.join("").includes("queuedhello")) {
      if (Date.now() > deadline) throw new Error("terminal did not accept input after reconnecting")
      await Bun.sleep(30)
    }
    expect(connections).toBe(2)
    expect(input.join("")).toBe("queuedhello")
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop(true)
  }
}, 20_000)
