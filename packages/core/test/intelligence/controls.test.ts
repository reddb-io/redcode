import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"
import { IntelligenceVerification } from "@opencode/core/intelligence/verification"
import { IntelligenceLearning } from "@opencode/core/intelligence/learning"
import { IntelligenceClassification } from "@opencode/core/intelligence/classification"
import { SessionContextCuration } from "@opencode/core/session/context-curation"
import { SessionMessage } from "@opencode/core/session/message"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import type { Tool } from "@opencode/core/tool"
import { user, tool, evaluation } from "./fixtures"

const marker = () =>
  SessionMessage.Synthetic.make({
    type: "synthetic",
    id: SessionMessage.ID.make("msg_verify"),
    text: "verify",
    metadata: { [IntelligenceVerification.KEY]: { userID: "msg_request" } },
    time: user("msg_request").time,
  })

test("observation data cannot guide tools, route or response repair", () => {
  const record = evaluation({
    mode: "observe",
    answers: {
      work_route: {
        type: "choice",
        choice: "external_operation",
        confidence: 1,
        probabilities: { external_operation: 1 },
      },
      tool_namespace: { type: "choice", choice: "deploy", confidence: 1, probabilities: { deploy: 1 } },
    },
  })
  expect(IntelligenceClassification.workRoute(record)).toBeUndefined()
  expect(IntelligenceClassification.toolNamespace(record)).toBeUndefined()
  expect(IntelligenceClassification.recommendations(record)).toEqual([])
  expect(
    Effect.runSyncExit(
      IntelligenceEvaluation.requireReview({ enabled: true, reasoning: "observe", onboarding: "completed" }, record),
    )._tag,
  ).toBe("Success")
})

test("session override wins over the saved mode without changing the saved settings", () => {
  const settings = {
    enabled: true,
    reasoning: "dual" as const,
    onboarding: "completed" as const,
    sessionReasoning: "single" as const,
  }
  expect(IntelligenceEvaluation.reasoning(settings)).toEqual({ reasoning: "single", source: "session" })
  expect(settings.reasoning).toBe("dual")
})

test("durable verification permits one Step and new input supersedes it", () => {
  expect(IntelligenceVerification.state([user("msg_request"), marker()])?.pending).toBe(true)
  expect(IntelligenceVerification.state([user("msg_request"), marker(), tool("msg_done", "read", {})])?.pending).toBe(
    false,
  )
  expect(IntelligenceVerification.state([user("msg_request"), marker(), user("msg_new")])).toBeUndefined()
})

test("verification denies invasive tools at execution, not just in listings", () => {
  const calls: string[] = []
  const snapshot: Tool.Snapshot = {
    definitions: [],
    execute: (input) =>
      Effect.sync(() => {
        calls.push(input.call.name)
        return { content: [] }
      }),
  }
  const restricted = IntelligenceVerification.restrict(snapshot)
  for (const name of ["bash", "shell", "execute", "mcp_write", "edit", "goal_complete", "subagent"]) {
    const exit = Effect.runSyncExit(
      restricted.execute({
        sessionID: "ses_fixture",
        agent: "build",
        messageID: "msg_fixture",
        call: { id: "call", name, input: {} },
      } as Parameters<Tool.Snapshot["execute"]>[0]),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  }
  expect(calls).toEqual([])
})

test("curation preserves calls/results together, live requests and edit evidence without changing originals", () => {
  const messages = [
    user("msg_old"),
    tool("msg_read", "read", {}),
    tool("msg_edit", "edit", {}),
    user("msg_middle"),
    tool("msg_recent", "read", {}),
    user("msg_latest"),
  ]
  const original = JSON.stringify(messages)
  const record = evaluation({
    operation: "context_curation",
    answers: {
      msg_read: { type: "noul", noul: 0.99 },
      msg_edit: { type: "noul", noul: 1 },
      msg_recent: { type: "noul", noul: 1 },
      msg_latest: { type: "noul", noul: 1 },
    },
  })
  const curated = SessionContextCuration.apply(messages, record)
  expect(curated.omitted.map((item) => item.messageID)).toEqual(["msg_read"])
  expect(curated.messages.map((message) => message.id)).toEqual([
    "msg_old",
    "msg_edit",
    "msg_middle",
    "msg_recent",
    "msg_latest",
  ])
  expect(JSON.stringify(messages)).toBe(original)
  expect(SessionContextCuration.apply(messages, { ...record, mode: "observe" }).messages).toBe(messages)
})

test("uncertain curation keeps the original model window", () => {
  const messages = [user("msg_old"), tool("msg_read", "read", {}), user("msg_mid"), user("msg_new")]
  expect(
    SessionContextCuration.apply(messages, evaluation({ answers: { msg_read: { type: "noul", noul: 0.8 } } })).omitted,
  ).toEqual([])
})

test("learning remains a proposal tied to both evidence artifacts and rejects ineffective repair", () => {
  const before = evaluation()
  const after = evaluation({ id: "eval_after", candidateID: "msg_revised", decision: "accepted", created: 2 })
  expect(IntelligenceLearning.candidate(before, after)).toMatchObject({
    status: "proposed",
    evaluations: ["eval_before", "eval_after"],
  })
  expect(IntelligenceLearning.candidate(before, { ...after, mode: "observe" })).toBeUndefined()
  expect(IntelligenceLearning.candidate(before, { ...after, candidateID: before.candidateID })).toBeUndefined()
  expect(IntelligenceLearning.candidate(before, { ...after, decision: "inconclusive" })).toBeUndefined()
})

test("semantic namespace ranking preserves the full namespace inventory and pinned discovery", () => {
  const catalog = {
    tools: ["alpha", "omega"].map((name) => ({
      type: "namespace" as const,
      name,
      tools: Array.from({ length: 20 }, (_, index) => ({
        type: "tool" as const,
        name: `tool${index}`,
        description: "Inspect evidence",
        signature: `${name}.tool${index}(): string`,
      })),
    })),
  }
  const baseline = CodeModeCatalog.summarize(catalog, { budget: 36 })
  const preferred = CodeModeCatalog.summarize(catalog, { budget: 36, preferred: ["omega"] })
  expect(preferred.total).toBe(baseline.total)
  expect(preferred.namespaces.map((namespace) => namespace.name)).toEqual(["alpha", "omega"])
  expect(preferred.namespaces.find((namespace) => namespace.name === "omega")!.entries.length).toBeGreaterThan(0)
})
