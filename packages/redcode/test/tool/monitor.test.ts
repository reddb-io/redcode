import { PermissionV1 } from "@reddb-io/redcode-core/v1/permission"
import { describe, expect } from "bun:test"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { Cause, Effect, Exit, Layer } from "effect"
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
      expect(requests).toHaveLength(1)
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
