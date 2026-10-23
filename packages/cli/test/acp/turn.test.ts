import { describe, expect, test } from "bun:test"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { ACPElicitation } from "../../src/acp/elicitation"
import {
  childCreated,
  delivered,
  durableEvent,
  ephemeralEvent,
  permissionAsked,
  startSession,
  stepEnded,
  succeeded,
  textDelta,
  toolCalled,
  toolStarted,
  toolSucceeded,
  turn,
} from "./wire-fixture"

const grandchild = {
  "opencode/child-session": { id: "ses_grandchild", parentID: "ses_child", depth: 2, title: "Deeper" },
}

test.each([
  { status: "reported", amount: 0, complete: true },
  { status: "estimated", amount: 0.125, complete: true },
  { status: "unknown", amount: 0.25, complete: false },
  { status: "legacy", amount: 0.5, complete: false },
  { status: "empty", amount: 0, complete: true },
  { status: undefined, amount: 0.5, complete: false },
] as const)("ACP qualifies aggregate cost provenance: $status", async (row) => {
  await using acp = await startSession({
    fetch: (request) =>
      request.path.endsWith("/budget")
        ? Response.json({
            data: {
              limits: {},
              override: {},
              spent: { cost: row.amount, tokens: 3, unpriced: row.status === "unknown" ? 1 : 0 },
              ...(row.status ? { costAssessment: { status: row.status } } : {}),
              exceeded: false,
              unknown: false,
              reason: "",
            },
          })
        : undefined,
    onPrompt: ({ sessionID, id }) => turn(sessionID, id, stepEnded(sessionID, "msg_usage")),
  })
  expect((await acp.prompt(acp.sessionId, "Compute")).stopReason).toBe("end_turn")
  const update = acp.updates.find((item) => item.update.sessionUpdate === "usage_update")?.update
  expect(update?.sessionUpdate).toBe("usage_update")
  if (update?.sessionUpdate !== "usage_update") throw new Error("Expected a usage update")
  expect(update.cost).toEqual(row.complete ? { amount: row.amount, currency: "USD" } : undefined)
  expect(update._meta).toEqual({
    "reddb.io/cost": {
      knownSubtotal: row.amount,
      currency: "USD",
      status: row.status ?? "legacy",
      scope: "session-and-descendants",
    },
  })
})

describe("acp turn events over the wire", () => {
  test.each([
    {
      childSessionUpdates: false,
      parent: [
        {
          sessionUpdate: "tool_call",
          toolCallId: "ses_grandchild:call_read",
          title: "Deeper: read",
          _meta: grandchild,
        },
        { sessionUpdate: "tool_call_update", toolCallId: "ses_grandchild:call_read", status: "in_progress" },
        { sessionUpdate: "tool_call_update", toolCallId: "ses_grandchild:call_read", status: "completed" },
      ],
      child: [],
    },
    {
      childSessionUpdates: true,
      parent: [],
      child: [
        { childSessionId: "ses_child", depth: 1, type: "status", status: "created" },
        { childSessionId: "ses_child", type: "status", status: "running" },
        {
          childSessionId: "ses_grandchild",
          parentSessionId: "ses_child",
          depth: 2,
          title: "Deeper",
          status: "created",
        },
        {
          childSessionId: "ses_grandchild",
          update: { sessionUpdate: "tool_call", toolCallId: "ses_grandchild:call_read" },
        },
        { childSessionId: "ses_grandchild", update: { sessionUpdate: "tool_call_update", status: "in_progress" } },
        { childSessionId: "ses_grandchild", update: { sessionUpdate: "tool_call_update", status: "completed" } },
        { childSessionId: "ses_grandchild", type: "status", status: "completed" },
        { childSessionId: "ses_background", type: "status", status: "created" },
        { childSessionId: "ses_child", type: "status", status: "completed" },
        { childSessionId: "ses_background", type: "status", status: "running" },
        { childSessionId: "ses_background", type: "update", update: { sessionUpdate: "agent_message_chunk" } },
        { childSessionId: "ses_background", type: "status", status: "completed" },
      ],
    },
  ])(
    "shows nested and background child work and routes its permissions (child capability: $childSessionUpdates)",
    async (row) => {
      await using acp = await startSession({
        capabilities: { childSessionUpdates: row.childSessionUpdates },
        onPrompt: ({ sessionID, id }) =>
          acp.server.prompts.length > 1
            ? turn(sessionID, id)
            : turn(
                sessionID,
                id,
                childCreated("ses_child", sessionID, "Explore code"),
                durableEvent("session.execution.started", { sessionID: "ses_child" }),
                childCreated("ses_grandchild", "ses_child", "Deeper"),
                toolStarted("ses_grandchild", "call_read", "read"),
                toolCalled("ses_grandchild", "call_read", { path: "/workspace/src/index.ts" }),
                permissionAsked("ses_grandchild", "perm_child", {
                  action: "read",
                  source: { type: "tool", messageID: "msg_child", id: "call_read" },
                }),
                toolSucceeded("ses_grandchild", "call_read", {}, "source"),
                succeeded("ses_grandchild"),
                childCreated("ses_background", sessionID, "Research"),
                succeeded("ses_child"),
              ),
        permission: () => ({ outcome: { outcome: "selected", optionId: "once" } }),
      })

      expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
      const responded = turnUpdates(acp.updates).length
      acp.server.send(
        durableEvent("session.execution.started", { sessionID: "ses_background" }),
        permissionAsked("ses_background", "perm_background", {
          action: "read",
          metadata: { path: "/workspace/notes.md" },
        }),
        textDelta("ses_background", "msg_background", "late"),
        succeeded("ses_background"),
        permissionAsked("ses_background", "perm_after_end", { action: "read" }),
      )
      await acp.until(() => acp.server.replies.length === 2, "child permission replies")
      expect(turnUpdates(acp.updates).slice(responded)).toEqual([])
      expect((await acp.prompt(acp.sessionId, "again")).stopReason).toBe("end_turn")

      expect(turnUpdates(acp.updates).map((item) => item.update)).toMatchObject(row.parent)
      expect(acp.childUpdates).toMatchObject(row.child)
      expect(acp.permissions).toMatchObject([
        {
          sessionId: acp.sessionId,
          toolCall: {
            toolCallId: "ses_grandchild:call_read",
            title: "Deeper: /workspace/src/index.ts",
            _meta: grandchild,
          },
        },
        {
          sessionId: acp.sessionId,
          toolCall: {
            toolCallId: "ses_background:perm_background",
            title: "Research: /workspace/notes.md",
            _meta: {
              "opencode/child-session": { id: "ses_background", parentID: acp.sessionId, depth: 1, title: "Research" },
            },
          },
        },
      ])
      expect(acp.server.replies).toEqual([
        { sessionID: "ses_grandchild", requestID: "perm_child", decision: "once" },
        { sessionID: "ses_background", requestID: "perm_background", decision: "once" },
      ])
    },
  )

  test("cancels unsupported session forms so execution can continue", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        ephemeralEvent("form.created", {
          form: {
            id: "frm_question",
            sessionID,
            title: "Questions",
            metadata: { kind: "question" },
            fields: [{ key: "q0", title: "Choice", type: "string" }],
          },
        }),
      ],
      onFormCancel: ({ sessionID, formID }) => [
        ephemeralEvent("form.cancelled", { sessionID, id: formID }),
        succeeded(sessionID),
      ],
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.server.cancelledForms).toEqual([
      { sessionID: acp.sessionId, formID: "frm_question", message: ACPElicitation.UnshownQuestionMessage },
    ])
    expect(acp.elicitations).toEqual([])
  })
})

function turnUpdates(updates: readonly SessionNotification[]) {
  return updates.filter(
    (item) => item.update.sessionUpdate !== "available_commands_update" && item.update.sessionUpdate !== "usage_update",
  )
}
