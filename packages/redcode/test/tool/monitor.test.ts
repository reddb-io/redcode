import { PermissionV1 } from "@reddb-io/redcode-core/v1/permission"
import { describe, expect } from "bun:test"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { Permission } from "@/permission"
import { EventV2Bridge } from "@/event-v2-bridge"
import { mkdir, symlink } from "fs/promises"
import path from "path"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MonitorRuntime } from "@/background/monitor"
import { Session } from "@/session/session"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { Tool } from "@/tool/tool"
import { Agent } from "../../src/agent/agent"
import { Plugin } from "../../src/plugin"
import { MessageID, SessionID } from "../../src/session/schema"
import { MonitorTool } from "../../src/tool/monitor"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(
      LayerNode.group([
        CrossSpawnSpawner.node,
        FSUtil.node,
        Plugin.node,
        ToolOutputBridge.node,
        Config.node,
        Agent.node,
        RuntimeFlags.node,
        MonitorRuntime.node,
        Session.node,
        Permission.node,
        EventV2Bridge.node,
      ]),
    ),
    testInstanceStoreLayer,
  ),
)

type Request = Omit<PermissionV1.Request, "id" | "sessionID" | "tool"> & { force?: boolean }

/** A context with no session continuation: a probe stops right after its permission checks. */
const capture = (requests: Request[]): Tool.Context => ({
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: (request) =>
    Effect.sync(() => {
      requests.push(request)
    }),
})

const probe = Effect.fn("MonitorToolTest.probe")(function* (
  directory: string,
  input: Tool.InferParameters<typeof MonitorTool>,
) {
  const requests: Request[] = []
  const tool = yield* (yield* MonitorTool).init()
  const exit = yield* tool.execute(input, capture(requests)).pipe(provideInstance(directory), Effect.exit)
  const error = Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : undefined
  return { requests, error }
})

describe("tool.monitor probes", () => {
  it.live("an http probe asks the webfetch permission for its URL, without header values", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { requests, error } = yield* probe(tmp, {
        action: "probe",
        probe: { type: "http", url: "http://127.0.0.1:9/health", headers: { Authorization: "Bearer {env:TOKEN}" } },
        interval_ms: 2_000,
        deadline_ms: 120_000,
      })
      expect(error).toContain("Monitors require session continuation support.")
      expect(requests.map((request) => request.permission)).toEqual(["webfetch", "env"])
      expect(requests[0]).toMatchObject({
        permission: "webfetch",
        patterns: ["http://127.0.0.1:9/health"],
        always: ["*"],
        metadata: {
          url: "http://127.0.0.1:9/health",
          monitor: "poll every 2s ±250ms, for up to 2m",
          headers: ["Authorization"],
        },
      })
      expect(requests[0]?.force).toBeUndefined()
      expect(JSON.stringify(requests)).not.toContain("{env:TOKEN}")
    }),
  )

  it.live("an environment variable in a header asks the env permission for that variable and host", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const secret = `secret-${crypto.randomUUID()}`
      process.env.MONITOR_PROBE_TEST_TOKEN = secret
      try {
        const { requests, error } = yield* probe(tmp, {
          action: "probe",
          probe: {
            type: "http",
            url: "http://127.0.0.1:9/health",
            headers: {
              Authorization: "Bearer {env:MONITOR_PROBE_TEST_TOKEN}",
              "X-Copy": "{env:MONITOR_PROBE_TEST_TOKEN}",
            },
          },
          deadline_ms: 120_000,
        })
        expect(error).toContain("Monitors require session continuation support.")
        // One ask per variable, however many headers use it.
        expect(requests.map((request) => request.permission)).toEqual(["webfetch", "env"])
        expect(requests[1]).toMatchObject({
          patterns: ["MONITOR_PROBE_TEST_TOKEN@127.0.0.1:9"],
          always: ["MONITOR_PROBE_TEST_TOKEN@127.0.0.1:9"],
          metadata: { variable: "MONITOR_PROBE_TEST_TOKEN", host: "127.0.0.1:9" },
        })
        expect(JSON.stringify(requests)).not.toContain(secret)
        expect(error).not.toContain(secret)
      } finally {
        delete process.env.MONITOR_PROBE_TEST_TOKEN
      }
    }),
  )

  it.live("a denied env permission blocks the probe before any request is sent", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      let hits = 0
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => {
          hits++
          return new Response("ok")
        },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
      const secret = `secret-${crypto.randomUUID()}`
      process.env.MONITOR_PROBE_DENIED_TOKEN = secret
      try {
        const requests: Request[] = []
        const context: Tool.Context = {
          ...capture(requests),
          extra: { promptOps: { notify: () => Effect.void } },
          ask: (request) =>
            Effect.sync(() => {
              requests.push(request)
              if (request.permission === "env") throw new Error("denied by rule")
            }),
        }
        const tool = yield* (yield* MonitorTool).init()
        const exit = yield* tool
          .execute(
            {
              action: "probe",
              probe: {
                type: "http",
                url: `http://127.0.0.1:${server.port}/health`,
                headers: { Authorization: "Bearer {env:MONITOR_PROBE_DENIED_TOKEN}" },
              },
              wait_ms: 0,
              interval_ms: 1_000,
              deadline_ms: 30_000,
            },
            context,
          )
          .pipe(provideInstance(tmp), Effect.exit)
        const error = Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : ""
        expect(error).toContain("denied by rule")
        expect(error).not.toContain(secret)
        yield* Effect.sleep("300 millis")
        expect(hits).toBe(0)
      } finally {
        delete process.env.MONITOR_PROBE_DENIED_TOKEN
      }
    }),
  )

  it.live("the env ask reaches a person under the real build rules, even when the config allows everything", () =>
    Effect.gen(function* () {
      let hits = 0
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => {
          hits++
          return new Response("ok")
        },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
      const secret = `secret-${crypto.randomUUID()}`
      process.env.MONITOR_PROBE_REAL_TOKEN = secret
      try {
        for (const config of [{}, { permission: { "*": "allow" as const } }]) {
          const tmp = yield* tmpdirScoped({ config })
          yield* Effect.gen(function* () {
            const permission = yield* Permission.Service
            const build = (yield* (yield* Agent.Service).get("build"))!
            const pattern = `MONITOR_PROBE_REAL_TOKEN@127.0.0.1:${server.port}`
            // Stock rules ask; a user "*": "allow" would let it through, which is why the ask is forced.
            expect(Permission.evaluate("env", pattern, build.permission).action).toBe(
              "permission" in config ? "allow" : "ask",
            )
            const context: Tool.Context = {
              ...capture([]),
              extra: { promptOps: { notify: () => Effect.void } },
              ask: (request) =>
                permission
                  .ask({ ...request, sessionID: SessionID.make("ses_test"), ruleset: build.permission })
                  .pipe(Effect.orDie),
              evaluate: (key, value) => Permission.evaluate(key, value, build.permission).action,
            }
            const tool = yield* (yield* MonitorTool).init()
            const fiber = yield* tool
              .execute(
                {
                  action: "probe",
                  probe: {
                    type: "http",
                    url: `http://127.0.0.1:${server.port}/health`,
                    headers: { Authorization: "Bearer {env:MONITOR_PROBE_REAL_TOKEN}" },
                  },
                  wait_ms: 0,
                  interval_ms: 1_000,
                  deadline_ms: 30_000,
                },
                context,
              )
              .pipe(Effect.exit, Effect.forkChild)
            let pending: PermissionV1.Request | undefined
            for (let i = 0; i < 200 && !pending; i++) {
              pending = (yield* permission.list()).find((request) => request.permission === "env")
              if (!pending) yield* Effect.sleep("10 millis")
            }
            expect(pending).toMatchObject({ permission: "env", patterns: [pattern], always: [pattern] })
            expect(JSON.stringify(pending)).not.toContain(secret)
            yield* permission.reply({ requestID: pending!.id, reply: "reject" })
            const exit = yield* Fiber.join(fiber)
            expect(Exit.isFailure(exit)).toBe(true)
          }).pipe(provideInstance(tmp))
        }
        yield* Effect.sleep("300 millis")
        expect(hits).toBe(0)
      } finally {
        delete process.env.MONITOR_PROBE_REAL_TOKEN
      }
    }),
  )

  it.live("a probe that may poll for over ten minutes is approved every time, never saved", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const http = yield* probe(tmp, {
        action: "probe",
        probe: { type: "http", url: "https://example.invalid/ready" },
        deadline_ms: 3_600_000,
      })
      expect(http.requests[0]).toMatchObject({ permission: "webfetch", always: [], force: true })
      const long = yield* probe(tmp, {
        action: "probe",
        probe: { type: "process", name: "vite", state: "exited" },
        deadline_ms: 3_600_000,
      })
      expect(long.requests).toEqual([expect.objectContaining({ permission: "monitor", always: [], force: true })])
      // Listing processes is read-only: a short process probe asks nothing. The default deadline (1h) is long.
      const short = yield* probe(tmp, {
        action: "probe",
        probe: { type: "process", pid: 1, state: "running" },
        deadline_ms: 300_000,
      })
      expect(short.requests).toEqual([])
      expect(short.error).toContain("Monitors require session continuation support.")
    }),
  )

  it.live("a file probe asks read, and external_directory when it leaves the project", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const inside = yield* probe(tmp, {
        action: "probe",
        probe: { type: "file", path: "dist/report.json", state: "exists" },
        deadline_ms: 300_000,
      })
      expect(inside.requests.map((request) => request.permission)).toEqual(["read"])
      expect(inside.requests[0]).toMatchObject({
        always: ["*"],
        metadata: { filepath: path.join(tmp, "dist", "report.json") },
      })
      expect(inside.requests[0]?.patterns[0]?.endsWith(path.join("dist", "report.json"))).toBe(true)
      const outside = yield* tmpdirScoped()
      const external = yield* probe(tmp, {
        action: "probe",
        probe: { type: "file", path: path.join(outside, "report.json"), state: "exists" },
        deadline_ms: 300_000,
      })
      expect(external.requests.map((request) => request.permission)).toEqual(["external_directory", "read"])
    }),
  )

  // Creating a symlink needs extra privileges on Windows.
  ;(process.platform === "win32" ? it.live.skip : it.live)(
    "a file probe through a symlink that escapes the project asks external_directory for its target",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const outside = yield* tmpdirScoped()
        yield* Effect.promise(() => mkdir(path.join(outside, "secrets"), { recursive: true }))
        yield* Effect.promise(() => symlink(path.join(outside, "secrets"), path.join(tmp, "link")))
        const { requests } = yield* probe(tmp, {
          action: "probe",
          probe: { type: "file", path: "link/token.txt", state: "changed" },
        })
        expect(requests.map((request) => request.permission)).toEqual(["external_directory", "read"])
        expect(requests[0]?.patterns[0]).toContain(path.join("secrets", "*"))
      }),
  )

  it.live("refuses an invalid probe before asking anything", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const both = yield* probe(tmp, {
        action: "probe",
        probe: { type: "process", name: "vite", pid: 3, state: "running" },
      })
      expect(both.requests).toEqual([])
      expect(both.error).toContain("exactly one of name or pid")
      const missing = yield* probe(tmp, { action: "probe" })
      expect(missing.error).toContain("needs a probe object")
    }),
  )
})
