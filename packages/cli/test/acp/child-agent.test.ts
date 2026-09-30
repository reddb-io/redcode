import { describe, expect, test } from "bun:test"
import type { McpServer, RequestError, RequestPermissionRequest } from "@agentclientprotocol/sdk"
import { ACPChildAgent } from "../../src/acp/child-agent"
import { ACPError } from "../../src/acp/error"
import { streamTurn } from "../../src/acp/event"
import { makeACPFixture, makeSession, type FixtureRequest } from "./service-fixture"
import { createSseFixture, durableEvent, ephemeralEvent } from "./sse-fixture"

const contract = {
  version: 1,
  parentSessionId: "workflow-session",
  workerId: "worker-17",
  authority: "parent",
  github: "parent-gateway",
  permissions: "parent",
} as const

const binding = {
  redskills: {
    childAgent: {
      version: 1,
      parentSessionId: "workflow-session",
      workerId: "worker-17",
      authority: "parent",
    },
  },
}

describe("RedSkills governed child Agent contract", () => {
  test("accepts the explicit parent-owned launch contract and projects the parent binding", () => {
    const parsed = ACPChildAgent.parse({ redskills: { childAgent: contract } })

    expect(parsed).toEqual(contract)
    expect(parsed ? ACPChildAgent.metadata(parsed) : undefined).toEqual(binding)
  })

  test("leaves an ordinary editor session ungoverned", () => {
    expect(ACPChildAgent.parse(undefined)).toBeUndefined()
    expect(ACPChildAgent.parse({ redskills: { dashboard: true } })).toBeUndefined()
    expect(ACPChildAgent.admit({}, [], { GITHUB_TOKEN: "editor-token" })).toBeUndefined()
  })

  test("rejects a malformed contract instead of downgrading it to an editor session", () => {
    expect(refusal(() => ACPChildAgent.parse({ redskills: { childAgent: { ...contract, authority: "self" } } }))).toBe(
      "Invalid RedSkills child Agent contract",
    )
  })

  test("refuses ambient GitHub authority and the GitHub CLI alias", () => {
    expect(refusal(() => ACPChildAgent.requireBoundary([], { GITHUB_TOKEN: "leaked" }))).toBe(
      "GitHub credentials belong to the parent",
    )
    expect(refusal(() => ACPChildAgent.requireBoundary([], { GH_TOKEN: "leaked" }))).toBe(
      "GitHub credentials belong to the parent",
    )
  })

  test("refuses ambient redskilled authority", () => {
    const env = { REDSKILLED_SOCKET: "/run/user/1000/redskilled.sock" }

    expect(refusal(() => ACPChildAgent.requireBoundary([], env))).toBe("redskilled authority belongs to the parent")
  })

  test("refuses a redskilled MCP side channel by name, command, or URL", () => {
    const servers: McpServer[] = [
      { name: "redskilled", command: "workflow-mcp", args: [], env: [] },
      { name: "workflow", command: "red-skills-redskilled-mcp", args: [], env: [] },
      { name: "workflow", type: "http", url: "http://redskilled.local/mcp", headers: [] },
    ]

    expect(servers.map((server) => refusal(() => ACPChildAgent.requireBoundary([server], {})))).toEqual(
      servers.map(() => "redskilled MCP side channel is forbidden for a governed child Agent"),
    )
    expect(
      refusal(() => ACPChildAgent.requireBoundary([{ name: "docs", command: "docs-mcp", args: [], env: [] }], {})),
    ).toBeUndefined()
  })
})

describe("RedSkills governed child Agent over the ACP service", () => {
  test("binds the Session to its parent and keeps the binding across turns", async () => {
    await using fixture = makeACPFixture({
      fetch(request, context) {
        if (request.method === "POST" && request.path === "/api/session") {
          return Response.json({ data: makeSession("ses_child") })
        }
        if (request.method === "POST" && request.path === "/api/session/ses_child/prompt") {
          const id = requestID(request)
          context.send({
            id: `evt_${id}`,
            type: "session.inbox.delivered",
            data: { sessionID: "ses_child", inboxID: id },
          })
          context.send({
            id: `evt_done_${id}`,
            type: "session.execution.succeeded",
            data: { sessionID: "ses_child" },
          })
          return Response.json({ data: {} })
        }
        return undefined
      },
    })

    const session = await fixture.service.newSession({
      cwd: "/workspace",
      mcpServers: [],
      _meta: { redskills: { childAgent: contract } },
    })
    const first = await fixture.service.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "first" }],
    })
    const second = await fixture.service.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "second" }],
    })

    expect(session._meta).toEqual(binding)
    expect([first.stopReason, second.stopReason]).toEqual(["end_turn", "end_turn"])
    expect([first._meta, second._meta]).toEqual([binding, binding])
  })

  test("rejects a governed child Agent that inherits GitHub authority before creating a Session", async () => {
    await using fixture = makeACPFixture({ env: { GITHUB_TOKEN: "leaked" } })

    const error = await fixture.service
      .newSession({ cwd: "/workspace", mcpServers: [], _meta: { redskills: { childAgent: contract } } })
      .then(
        () => undefined,
        (cause: unknown) => cause,
      )

    expect(error).toBeInstanceOf(ACPError.InvalidChildAgentError)
    const request = toRequestError(error)
    expect(request?.code).toBe(-32602)
    expect(request?.message).toContain("GitHub credentials belong to the parent")
    expect(fixture.requests.some((item) => item.method === "POST" && item.path === "/api/session")).toBe(false)
  })

  test("rejects a malformed contract as invalid ACP parameters", async () => {
    await using fixture = makeACPFixture()

    const error = await fixture.service
      .newSession({ cwd: "/workspace", mcpServers: [], _meta: { redskills: { childAgent: { version: 2 } } } })
      .then(
        () => undefined,
        (cause: unknown) => cause,
      )

    expect(toRequestError(error)?.message).toContain("Invalid RedSkills child Agent contract")
  })

  test("binds permission requests of the turn to the parent", async () => {
    const requests: RequestPermissionRequest[] = []
    const fixture = createSseFixture({
      onPrompt({ id, send }) {
        send(durableEvent("session.inbox.delivered", { sessionID: "ses_child", inboxID: id }))
        send(
          ephemeralEvent("permission.asked", {
            id: "perm_child",
            sessionID: "ses_child",
            action: "shell",
            resources: ["*"],
            metadata: { command: "printf hello" },
          }),
        )
        send(durableEvent("session.execution.succeeded", { sessionID: "ses_child" }))
      },
    })

    try {
      await streamTurn({
        client: fixture.client,
        connection: {
          sessionUpdate: async () => {},
          requestPermission: async (request) => {
            requests.push(request)
            return { outcome: { outcome: "selected", optionId: "once" } }
          },
        },
        sessionID: "ses_child",
        cwd: "/workspace",
        start: { type: "input", id: "input_child" },
        writeTextFile: false,
        control: { cancelled: false, admission: new AbortController() },
        permissionMeta: binding,
        submit: (signal) =>
          fixture.client.session.prompt({ sessionID: "ses_child", id: "input_child", text: "hello" }, { signal }),
      })

      expect(requests.map((request) => request._meta)).toEqual([binding])
    } finally {
      await fixture.stop()
    }
  })
})

function refusal(run: () => unknown) {
  try {
    run()
    return undefined
  } catch (error) {
    if (error instanceof ACPError.InvalidChildAgentError) return error.reason
    throw error
  }
}

function toRequestError(error: unknown): RequestError | undefined {
  if (!(error instanceof ACPError.InvalidChildAgentError)) return undefined
  return ACPError.toRequestError(error)
}

function requestID(request: FixtureRequest) {
  if (!request.body || typeof request.body !== "object") throw new Error(`missing body for ${request.path}`)
  const id = "id" in request.body ? request.body.id : undefined
  if (typeof id !== "string") throw new Error(`missing prompt id for ${request.path}`)
  return id
}
