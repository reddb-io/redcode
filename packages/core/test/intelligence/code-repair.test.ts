import path from "node:path"
import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { IntelligenceCodeRepair } from "@opencode/core/intelligence/code-repair"
import { IntelligenceResponse } from "@opencode/core/intelligence/response"
import { SessionTaskFacts } from "@opencode/core/session/task-facts"
import { SessionMessage } from "@opencode/core/session/message"
import type { Tool } from "@opencode/core/tool"
import { user, tool, evaluation } from "./fixtures"

const directory = path.resolve("code-review-fixture")
const scope = {
  directory,
  paths: [path.join(directory, "src.ts").replaceAll("\\", "/").toLowerCase()],
  commands: [{ command: "bun run test", workdir: directory }],
}
const marker = () =>
  SessionMessage.Synthetic.make({
    id: SessionMessage.ID.make("msg_code_repair"),
    type: "synthetic",
    text: "repair",
    metadata: { [IntelligenceCodeRepair.KEY]: { userID: "msg_request", scope } },
    time: user("msg_request").time,
  })

test("code review shows immutable artifact identity and preserves clipped evidence as incomplete", () => {
  const artifact = IntelligenceCodeRepair.artifact({
    from: "seed",
    to: "candidate",
    files: [{ file: "src.ts", patch: "buggy code\n".repeat(2000) }],
  })
  const request = IntelligenceResponse.evaluation({
    sessionID: "ses_fixture",
    request: { id: "msg_request", text: "Preserve input order" },
    candidate: { id: "msg_candidate", text: "Everything is correct" },
    attempt: 0,
    tools: { total: 0, calls: [] },
    tasks: [],
    goal: undefined,
    artifact,
  })
  expect(request.questions).toHaveProperty("code_behavior")
  expect(request.questions).toHaveProperty("code_contract")
  expect(artifact).toMatchObject({ from: "seed", to: "candidate", totalFiles: 1, omittedFiles: 0 })
  expect(JSON.stringify(artifact)).toContain("truncated")
  expect(JSON.stringify(artifact).length).toBeLessThan(8_000)
})

test("repair scope is the intersection of successful local edits and settled foreground test calls", () => {
  const messages = [
    tool("msg_edit", "edit", { path: "src.ts" }),
    tool("msg_external", "edit", { path: path.resolve(directory, "../elsewhere.ts") }),
    tool("msg_denied", "edit", { path: "protected.ts" }, { error: "denied" }),
    tool("msg_test", "shell", { command: "bun run test" }, { exit: 1 }),
    tool("msg_chained", "shell", { command: "bun run test; npm publish" }, { exit: 0 }),
    tool("msg_background", "shell", { command: "bun test", background: true }),
  ]
  const result = IntelligenceCodeRepair.scope(SessionTaskFacts.project(messages, directory), directory)
  expect(result?.paths).toEqual(SessionTaskFacts.paths("edit", { path: "src.ts" }, directory))
  expect(result?.commands).toEqual([{ command: "bun run test", workdir: directory }])
  expect(
    IntelligenceCodeRepair.scope(SessionTaskFacts.project(messages.slice(1), directory), directory),
  ).toBeUndefined()
})

test("bounded code repair survives replay, stops after four attempts and yields to new user input", () => {
  const initial = [user("msg_request"), marker()]
  expect(IntelligenceCodeRepair.state(initial)).toMatchObject({ pending: true, remaining: 4 })
  const attempts = Array.from({ length: 4 }, (_, index) => tool(`msg_attempt_${index}`, "read", { path: "src.ts" }))
  expect(IntelligenceCodeRepair.state([...initial, ...attempts.slice(0, 3)])).toMatchObject({
    pending: true,
    remaining: 1,
  })
  expect(IntelligenceCodeRepair.state([...initial, ...attempts])).toMatchObject({ pending: false, remaining: 0 })
  expect(IntelligenceCodeRepair.state([...initial, user("msg_next")])).toBeUndefined()
  expect(
    IntelligenceCodeRepair.state([
      user("msg_request"),
      { ...marker(), metadata: { [IntelligenceCodeRepair.KEY]: { userID: "msg_request", scope: null } } },
    ]),
  ).toBeUndefined()
})

test("repair execution denies unscoped edits, other commands, wrappers and background work", () => {
  const calls: string[] = []
  const snapshot: Tool.Snapshot = {
    definitions: [],
    execute: (input) =>
      Effect.sync(() => {
        calls.push(input.call.name)
        return { content: [] }
      }),
  }
  const normalized = { ...scope, paths: SessionTaskFacts.paths("edit", { path: "src.ts" }, directory) }
  const restricted = IntelligenceCodeRepair.restrict(snapshot, normalized, false)
  const execute = (name: string, input: unknown) =>
    restricted.execute({
      sessionID: "ses_fixture",
      agent: "build",
      messageID: "msg_fixture",
      call: { id: "call", name, input },
    } as Parameters<Tool.Snapshot["execute"]>[0])
  for (const [name, input] of [
    ["edit", { path: "protected.ts" }],
    ["write", { path: "../external.ts" }],
    ["patch", { patchText: "*** Update File: src.ts\n*** Move to: protected.ts\n" }],
    ["shell", { command: "npm publish" }],
    ["shell", { command: "bun run test", background: true }],
    ["shell", { command: "bun run test", workdir: ".." }],
    ["execute", {}],
    ["subagent", {}],
  ] as const)
    expect(Exit.isFailure(Effect.runSyncExit(execute(name, input)))).toBe(true)
  expect(calls).toEqual([])
  expect(Exit.isSuccess(Effect.runSyncExit(execute("edit", { path: "src.ts" })))).toBe(true)
  expect(Exit.isSuccess(Effect.runSyncExit(execute("shell", { command: "bun run test" })))).toBe(true)
  expect(calls).toEqual(["edit", "shell"])
  expect(
    Exit.isFailure(
      Effect.runSyncExit(
        IntelligenceCodeRepair.restrict(snapshot, normalized, true).execute({
          sessionID: "ses_fixture",
          agent: "build",
          messageID: "msg_fixture",
          call: { id: "final", name: "read", input: { path: "src.ts" } },
        } as Parameters<Tool.Snapshot["execute"]>[0]),
      ),
    ),
  ).toBe(true)
})

test("inconclusive suspicion and observation never trigger a code repair", () => {
  expect(
    IntelligenceCodeRepair.issues(evaluation({ answers: { code_behavior: { type: "noul", noul: 0.6 } } })),
  ).toEqual([])
  expect(
    IntelligenceCodeRepair.issues(
      evaluation({ mode: "observe", answers: { code_behavior: { type: "noul", noul: 1 } } }),
    ),
  ).toEqual([])
  expect(
    IntelligenceCodeRepair.issues(evaluation({ answers: { code_behavior: { type: "noul", noul: 0.8 } } })),
  ).toEqual(["code_behavior"])
})

test("an edit invalidates previous successful tests until the allowed test is rerun", () => {
  const tested = tool("msg_test", "shell", { command: "bun run test" }, { exit: 0, completed: 1 })
  const changed = tool("msg_edit", "edit", { path: "src.ts" }, { completed: 2 })
  expect(IntelligenceCodeRepair.verified(SessionTaskFacts.project([tested, changed], directory), scope)).toBe(false)
  const retested = tool("msg_retest", "shell", { command: "bun run test" }, { exit: 0, completed: 3 })
  expect(IntelligenceCodeRepair.verified(SessionTaskFacts.project([tested, changed, retested], directory), scope)).toBe(
    true,
  )
})
