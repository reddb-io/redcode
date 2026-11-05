import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test("shows a running wait with its target and elapsed time, then clears it on completion", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const sessionID = "ses_wait_fixture"
  const session = {
    id: sessionID,
    projectID: "project",
    title: "Wait fixture",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const created = Date.now() - 65_000
  let monitoring = true
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/active")
      return json({
        data: {
          [sessionID]: {
            type: "running",
            waits: [
              { id: "wait_mcp", kind: "mcp", started: created, target: "tool registration" },
              { id: "wait_model", kind: "model", started: created, target: "provider/model" },
            ],
          },
        },
      })
    if (url.pathname === `/api/session/${sessionID}`) return json({ data: session })
    if (url.pathname === `/api/session/${sessionID}/monitor`)
      return json({
        data: [
          {
            id: "mon_build",
            sessionID,
            command: "Build readiness",
            workdir: directory,
            options: { mode: "poll", interval_ms: 5_000, deadline_ms: 120_000 },
            status: monitoring ? "running" : "succeeded",
            created,
            updated: created,
            attempts: 0,
            delivery: "pending",
          },
        ],
      })
    if (url.pathname === `/api/session/${sessionID}/message`)
      return json({
        data: [
          {
            type: "assistant",
            id: "msg_wait_assistant",
            agent: "build",
            model: { providerID: "fixture", id: "fixture" },
            time: { created },
            content: [
              {
                type: "tool",
                id: "wait_tool",
                name: "monitor",
                state: { status: "running", input: { action: "wait", id: "mon_build" }, metadata: {} },
                time: { created, ran: created },
              },
            ],
          },
          { type: "user", id: "msg_wait_user", text: "Wait", time: { created: created - 1 } },
        ],
        cursor: {},
      })
    if (url.pathname === `/api/session/${sessionID}/permission`)
      return json({ data: [{ id: "per_fixture", sessionID, action: "shell", resources: ["pwd"], created }] })
    if (["inbox", "form"].some((name) => url.pathname === `/api/session/${sessionID}/${name}`))
      return json({ data: [] })
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes("Waiting for monitor mon_build"))
    await setup.waitForFrame((frame) => frame.includes("Waiting for MCP: tool registration"))
    expect(setup.captureCharFrame()).toContain("Waiting for model response: provider/model")
    expect(setup.captureCharFrame()).toContain("Waiting for permission: shell")
    events.emit({
      id: "evt_waits_clear",
      type: "session.wait.changed",
      created: Date.now(),
      data: { sessionID, waits: [] },
    })
    events.emit({
      id: "evt_permission_replied",
      type: "permission.replied",
      created: Date.now(),
      data: { sessionID, requestID: "per_fixture", reply: "once" },
    })
    await setup.waitForFrame(
      (frame) => !frame.includes("Waiting for MCP:") && !frame.includes("Waiting for permission:"),
    )
    expect(setup.captureCharFrame()).toMatch(/Waiting for monitor mon_build · 1m \d+s/)
    expect(setup.captureCharFrame()).not.toContain("Monitoring Build readiness (mon_build)")
    events.emit({
      id: "evt_finished",
      type: "session.execution.succeeded",
      created: Date.now(),
      durable: { aggregateID: sessionID, seq: 1, version: 1 },
      data: { sessionID },
    })
    await setup.waitForFrame((frame) => frame.includes("Monitoring Build readiness (mon_build)"))
    expect(setup.captureCharFrame()).not.toContain("Waiting for monitor mon_build")
    monitoring = false
    events.emit({
      id: "evt_monitor_finished",
      type: "monitor.finished",
      created: Date.now(),
      data: { sessionID, monitorID: "mon_build", command: "Build readiness", status: "succeeded" },
    })
    await setup.waitForFrame((frame) => !frame.includes("Monitoring Build readiness (mon_build)"))
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop(true)
  }
}, 30_000)
