import { describe, expect, test } from "bun:test"
import { AgentSideConnection, ndJsonStream, type Agent } from "@agentclientprotocol/sdk"
import { createSession, type AdapterProcess } from "../../src/redskilled/client"

describe("public redskilled ACP client", () => {
  test("binds a Project session and projects state through advertised controls", async () => {
    const calls: string[] = []
    const adapter = fakeAdapter(() => ({
      async initialize(params) {
        expect(params._meta).toEqual({ redskills: { wireMajor: 1 } })
        return {
          protocolVersion: 1,
          agentCapabilities: { promptCapabilities: {} },
          _meta: {
            redskills: {
              projectControl: {
                version: 1,
                methods: ["_redskills/project_drain", "_redskills/project_stop", "_redskills/project_status"],
              },
            },
          },
        }
      },
      async newSession(params) {
        expect(params).toMatchObject({ cwd: "/workspace/acme", mcpServers: [] })
        return { sessionId: "session-1" }
      },
      async prompt() {
        return { stopReason: "end_turn" }
      },
      async authenticate() {},
      async cancel() {},
      async extMethod(method) {
        calls.push(method)
        if (method === "_redskills/host_state") {
          return {
            project_id: "github:15",
            project_label: "acme/widgets",
            workspace_path: "/redskills/widgets",
            workers: [{ worker_id: "worker-1", pid: 42, started_at: "2026-08-17T12:00:00.000Z" }],
          }
        }
        return {
          version: 1,
          project_id: "github:15",
          project_label: "acme/widgets",
          workspace_path: "/redskills/widgets",
          drain_intent: method === "_redskills/project_drain" ? "draining" : "inactive",
          revision: method === "_redskills/project_drain" ? 1 : 0,
          updates: [],
        }
      },
    }))

    const session = await createSession("/workspace/acme", { timeoutMs: 500, spawn: adapter.spawn })
    try {
      await expect(session.snapshot()).resolves.toMatchObject({
        state: { project_label: "acme/widgets", workers: [{ worker_id: "worker-1" }] },
        control: { drain_intent: "inactive" },
      })
      await expect(session.control("drain")).resolves.toMatchObject({ drain_intent: "draining" })
      expect(calls).toEqual(["_redskills/host_state", "_redskills/project_status", "_redskills/project_drain"])
    } finally {
      session.close()
      expect(adapter.closed()).toBe(true)
    }
  })

  test("routes workflow decisions through generic ACP prompts", async () => {
    const calls: string[] = []
    const prompts: unknown[] = []
    const adapter = fakeAdapter((connection) => ({
      async initialize() {
        return {
          protocolVersion: 1,
          agentCapabilities: { promptCapabilities: {} },
          _meta: {
            redskills: {
              projectControl: {
                version: 1,
                methods: ["_redskills/project_drain", "_redskills/project_stop", "_redskills/project_status"],
              },
            },
          },
        }
      },
      async newSession() {
        return { sessionId: "session-1" }
      },
      async prompt(params) {
        prompts.push(params.prompt)
        await completedTool(connection, params.sessionId, `tool-${prompts.length}`)
        return { stopReason: "end_turn" }
      },
      async authenticate() {},
      async cancel() {},
      async extMethod(method) {
        calls.push(method)
        return {}
      },
    }))

    const session = await createSession("/workspace/acme", { timeoutMs: 500, spawn: adapter.spawn })
    try {
      await expect(session.workflow("resize", { target: 3 })).resolves.toBeUndefined()
      await expect(session.workflow("stopWorker", { worker: "worker-1" })).resolves.toBeUndefined()
      await expect(session.workflow("recycleWorker", { worker: "worker-1" })).resolves.toBeUndefined()
      await expect(
        session.workflow("steerWorker", { worker: "worker-1", text: "finish tests" }),
      ).resolves.toBeUndefined()
      expect(calls).toEqual([])
      expect(prompts).toEqual([
        [{ type: "text", text: '/project_resize {"target":3}' }],
        [{ type: "text", text: '/worker_stop {"worker":"worker-1"}' }],
        [{ type: "text", text: '/worker_recycle {"worker":"worker-1"}' }],
        [{ type: "text", text: '/runner_steer {"worker":"worker-1","text":"finish tests"}' }],
      ])
    } finally {
      session.close()
    }
  })

  test("rejects a bare end_turn without completed tool evidence", async () => {
    const adapter = fakeAdapter(() => ({
      async initialize() {
        return { protocolVersion: 1, agentCapabilities: { promptCapabilities: {} } }
      },
      async newSession() {
        return { sessionId: "session-1" }
      },
      async prompt() {
        return { stopReason: "end_turn" }
      },
      async authenticate() {},
      async cancel() {},
    }))

    const session = await createSession("/workspace/acme", { timeoutMs: 500, spawn: adapter.spawn })
    try {
      await expect(session.workflow("resize", { target: 3 })).rejects.toThrow(
        "redskilled ACP resize returned end_turn without completed tool-call evidence",
      )
      await expect(session.workflow("resize", { target: 3 })).rejects.toThrow(
        "redskilled ACP session is unusable after an uncertain workflow outcome",
      )
    } finally {
      session.close()
    }
  })

  test("cancels and poisons a workflow session after timeout", async () => {
    let prompts = 0
    let cancellations = 0
    const adapter = fakeAdapter(() => ({
      async initialize() {
        return { protocolVersion: 1, agentCapabilities: { promptCapabilities: {} } }
      },
      async newSession() {
        return { sessionId: "session-1" }
      },
      async prompt() {
        prompts += 1
        return await new Promise<never>(() => {})
      },
      async authenticate() {},
      async cancel() {
        cancellations += 1
      },
    }))

    const session = await createSession("/workspace/acme", { timeoutMs: 30, spawn: adapter.spawn })
    await expect(session.workflow("stopWorker", { worker: "worker-1" })).rejects.toThrow("timed out")
    await Bun.sleep(10)
    expect(cancellations).toBe(1)
    expect(adapter.closed()).toBe(true)
    await expect(session.workflow("stopWorker", { worker: "worker-1" })).rejects.toThrow(
      "redskilled ACP session is unusable after an uncertain workflow outcome",
    )
    expect(prompts).toBe(1)
  })

  test("grants allow-once permission only during an explicit workflow turn", async () => {
    let connection: AgentSideConnection
    let during: unknown
    const adapter = fakeAdapter((current) => {
      connection = current
      return {
        async initialize() {
          return { protocolVersion: 1, agentCapabilities: { promptCapabilities: {} } }
        },
        async newSession() {
          return { sessionId: "session-1" }
        },
        async prompt(params) {
          during = await current.requestPermission({
            sessionId: params.sessionId,
            toolCall: { toolCallId: "tool-1", title: "Resize Project", kind: "execute" },
            options: [
              { optionId: "always", name: "Always", kind: "allow_always" },
              { optionId: "once", name: "Once", kind: "allow_once" },
            ],
          })
          await completedTool(current, params.sessionId, "tool-1")
          return { stopReason: "end_turn" }
        },
        async authenticate() {},
        async cancel() {},
      }
    })

    const session = await createSession("/workspace/acme", { timeoutMs: 500, spawn: adapter.spawn })
    try {
      await session.workflow("resize", { target: 3 })
      expect(during).toMatchObject({
        outcome: { outcome: "selected", optionId: "once" },
        _meta: { redskills: { permissionResolution: "explicit-control-allow-once" } },
      })
      await expect(
        connection!.requestPermission({
          sessionId: "session-1",
          toolCall: { toolCallId: "tool-2", title: "Late request", kind: "execute" },
          options: [{ optionId: "once", name: "Once", kind: "allow_once" }],
        }),
      ).resolves.toMatchObject({ outcome: { outcome: "cancelled" } })
    } finally {
      session.close()
    }
  })

  test("reports structured generic ACP refusals without parsing prose", async () => {
    const adapter = fakeAdapter(() => ({
      async initialize() {
        return { protocolVersion: 1, agentCapabilities: { promptCapabilities: {} } }
      },
      async newSession() {
        return { sessionId: "session-1" }
      },
      async prompt() {
        return { stopReason: "refusal" }
      },
      async authenticate() {},
      async cancel() {},
    }))

    const session = await createSession("/workspace/acme", { timeoutMs: 500, spawn: adapter.spawn })
    try {
      await expect(session.workflow("stopWorker", { worker: "worker-1" })).rejects.toThrow(
        "redskilled ACP stopWorker ended with refusal",
      )
    } finally {
      session.close()
    }
  })

  test("fails clearly when the public Project status projection is unavailable", async () => {
    const adapter = fakeAdapter(() => ({
      async initialize() {
        return {
          protocolVersion: 1,
          agentCapabilities: { promptCapabilities: {} },
          _meta: {
            redskills: {
              projectControl: { version: 1, methods: ["_redskills/project_status"] },
            },
          },
        }
      },
      async newSession() {
        return { sessionId: "session-1" }
      },
      async prompt() {
        return { stopReason: "end_turn" }
      },
      async authenticate() {},
      async cancel() {},
      async extMethod(method) {
        throw new Error(`method not found: ${method}`)
      },
    }))

    const session = await createSession("/workspace/acme", { timeoutMs: 500, spawn: adapter.spawn })
    try {
      await expect(session.snapshot()).rejects.toThrow("redskilled ACP Project status is unavailable: Internal error")
    } finally {
      session.close()
    }
  })

  test("fails within the requested deadline when the public adapter stays silent", async () => {
    const adapter = fakeAdapter()
    const started = Date.now()

    await expect(createSession("/workspace/acme", { timeoutMs: 30, spawn: adapter.spawn })).rejects.toThrow("timed out")
    expect(Date.now() - started).toBeLessThan(250)
  })

  test("reports public adapter exit stderr", async () => {
    const adapter = fakeAdapter(undefined, { exitCode: 23, stderr: "machine claim rendezvous failed" })

    await expect(createSession("/workspace/acme", { timeoutMs: 500, spawn: adapter.spawn })).rejects.toThrow(
      /red-skills-redskilled acp exited with code 23 during initialize.*machine claim rendezvous failed/s,
    )
  })

  test("keeps RedSkills ownership on public ACP", async () => {
    const files = [
      "../../src/redskilled/client.ts",
      "../../src/server/routes/instance/httpapi/groups/redskilled.ts",
      "../../src/server/routes/instance/httpapi/handlers/redskilled.ts",
      "../../../schema/src/redskilled.ts",
      "../../../tui/src/app.tsx",
      "../../../tui/src/context/redskilled.tsx",
      "../../../tui/src/routes/workers.tsx",
      "../../../tui/src/routes/workers/history.ts",
    ]
    const sources = await Promise.all(
      files.map(async (file) => ({ file, source: await Bun.file(new URL(file, import.meta.url)).text() })),
    )
    const client = sources.find(({ file }) => file.endsWith("src/redskilled/client.ts"))!.source
    const handler = sources.find(({ file }) => file.endsWith("handlers/redskilled.ts"))!.source

    expect(client).toContain('Bun.spawn(["red-skills-redskilled", "acp"]')
    expect(client).toContain("connection.prompt")
    expect(handler).toMatch(/session\.workflow[\s\S]*Effect\.tapError\(\(\) => InstanceState\.invalidate\(clients\)\)/)
    expect(client).not.toMatch(/_redskills\/(?:project_resize|worker_stop|worker_recycle|runner_steer|steer_status)/)
    for (const item of sources) {
      expect(item.source, item.file).not.toMatch(
        /redskilled[^\n]*\.sock|XDG_RUNTIME_DIR|REDSKILLED_SESSION|node:net|createHash|@reddb-io\/toon|@modelcontextprotocol|@\/mcp|\.callTool\(|redskilled-consent|readConsent|writeConsent/,
      )
    }
  })
})

function fakeAdapter(
  agent?: (connection: AgentSideConnection) => Agent,
  options: { exitCode?: number; stderr?: string } = {},
) {
  let closed = false
  return {
    spawn(): AdapterProcess {
      const clientToAgent = new TransformStream<Uint8Array>()
      const agentToClient = new TransformStream<Uint8Array>()
      let resolveExit: (code: number) => void = () => {}
      const exited =
        options.exitCode === undefined
          ? new Promise<number>((resolve) => {
              resolveExit = resolve
            })
          : Promise.resolve(options.exitCode)
      if (agent)
        new AgentSideConnection(
          (connection) => agent(connection),
          ndJsonStream(agentToClient.writable, clientToAgent.readable),
        )
      else void clientToAgent.readable.pipeTo(new WritableStream())
      return {
        writable: clientToAgent.writable,
        readable: agentToClient.readable,
        exited,
        stderr: () => options.stderr ?? "",
        close() {
          closed = true
          resolveExit(0)
        },
      }
    },
    closed: () => closed,
  }
}

async function completedTool(connection: AgentSideConnection, sessionId: string, toolCallId: string) {
  await connection.sessionUpdate({
    sessionId,
    update: { sessionUpdate: "tool_call", toolCallId, title: "RedSkills workflow", status: "completed" },
  })
}
