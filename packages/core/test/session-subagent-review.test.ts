import { describe, expect, test } from "bun:test"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { SubagentReview } from "@reddb-io/redcode-core/session/subagent-review"

const complete = {
  prompt: "Find every caller of SessionPrompt.loop in packages/redcode/src and list them.",
  scope: ["packages/redcode/src/**"],
  doneCriteria: ["every caller of SessionPrompt.loop is listed"],
  returnFormat: "file:line list",
  writeCapable: true,
}

describe("SubagentReview.briefStructure", () => {
  const cases: Array<[string, SubagentReview.BriefInput, string[], boolean]> = [
    ["a complete brief", complete, [], false],
    ["an empty prompt blocks alone", { ...complete, prompt: "   " }, ["empty_prompt"], true],
    ["a short prompt", { ...complete, prompt: "fix it" }, ["short_prompt"], false],
    // Code points, not UTF-16 units or bytes: 20 ideographs are short in any script.
    ["a short prompt in another script", { ...complete, prompt: "修".repeat(20) }, ["short_prompt"], false],
    ["no done criteria", { ...complete, doneCriteria: undefined }, ["missing_done_criteria"], false],
    ["blank done criteria", { ...complete, doneCriteria: ["", "  "] }, ["missing_done_criteria"], false],
    ["no return format", { ...complete, returnFormat: " " }, ["missing_return_format"], false],
    ["no scope for a write-capable agent", { ...complete, scope: [] }, ["missing_scope"], false],
    ["no scope for a read-only agent", { ...complete, scope: undefined, writeCapable: false }, [], false],
  ]
  test.each(cases)("%s", (_name, input, ids, blocking) => {
    const findings = SubagentReview.briefStructure(input)
    expect(findings.map((finding) => finding.id)).toEqual(ids)
    expect(findings.some((finding) => finding.blocking)).toBe(blocking)
  })
})

describe("SubagentReview.revision and rejection", () => {
  test("turns issues into questions without repeats, and ignores unknown ids", () => {
    const questions = SubagentReview.revision([
      "missing_return_format",
      "unspecified_output",
      "0:missing_scope",
      "something_else",
    ])
    expect(questions).toHaveLength(2)
    expect(questions[0]).toContain("return_format")
    expect(questions[1]).toContain("scope")
  })

  test("a rejection names the evaluation, the issues and what to answer", () => {
    const message = SubagentReview.rejection("general", {
      verdict: "needs_revision",
      issues: ["missing_done_criteria"],
      evaluationID: "ev-1",
    })
    expect(message).toContain("general subagent needs revision (S1 evaluation ev-1)")
    expect(message).toContain("Issues: missing_done_criteria")
    expect(message).toContain("done_criteria")
  })

  test("only a clean or skipped verdict leaves no note", () => {
    expect(SubagentReview.note({ verdict: "verified", issues: [] })).toBeUndefined()
    expect(SubagentReview.note({ verdict: "skipped", issues: [] })).toBeUndefined()
    expect(SubagentReview.note({ verdict: "unverified", issues: [] })).toContain(Intelligence.UNVERIFIED)
    expect(SubagentReview.note({ verdict: "inconclusive", issues: [], unavailable: "timeout" })).toContain("timeout")
    expect(SubagentReview.note({ verdict: "needs_revision", issues: ["overreach"], evaluationID: "ev" })).toContain(
      "overreach",
    )
  })

  test("the S1 questions are yes-is-an-error noul questions", () => {
    expect(Object.keys(SubagentReview.briefQuestions).toSorted()).toEqual([
      "misaligned_with_request",
      "missing_context",
      "missing_done_criteria",
      "missing_scope",
      "overreach",
      "unspecified_output",
    ])
    expect(Object.values(SubagentReview.briefQuestions).every((question) => question.type === "noul")).toBe(true)
  })
})

describe("SubagentReview.instructions", () => {
  test("renders only the structured fields that were given", () => {
    expect(SubagentReview.instructions({})).toBeUndefined()
    expect(SubagentReview.instructions({ scope: [" "], criteria: [] })).toBeUndefined()
    const text = SubagentReview.instructions({ scope: ["src/**"], criteria: ["tests pass"], returnFormat: "a diff" })
    expect(text).toContain("- src/**")
    expect(text).toContain("- tests pass")
    expect(text).toContain("Return format: a diff")
  })
})

describe("SubagentReview metadata", () => {
  test("round-trips a brief and ignores foreign or malformed values", () => {
    const brief: SubagentReview.Brief = {
      brief: "do it",
      agent: "general",
      scope: ["src/**"],
      criteria: ["done"],
      writeCapable: true,
      parentSessionID: "ses_parent",
      verdict: "verified",
      issues: [],
      created: 1,
    }
    const metadata = SubagentReview.toMetadata({ other: 1 }, brief)
    expect(metadata.other).toBe(1)
    expect(SubagentReview.fromMetadata(metadata)).toEqual(brief)
    expect(SubagentReview.fromMetadata(undefined)).toBeUndefined()
    expect(SubagentReview.fromMetadata({ [SubagentReview.METADATA_KEY]: { brief: 1 } })).toBeUndefined()
  })
})

describe("SubagentReview.scopeViolations", () => {
  const call = (tool: string, input: unknown, status = "completed"): SubagentReview.Part => ({
    type: "tool",
    tool,
    callID: `${tool}-call`,
    state: { status, input },
  })
  const cases: Array<[string, SubagentReview.Part[], string[] | undefined, string[]]> = [
    ["no scope means no boundary", [call("edit", { filePath: "/repo/elsewhere.ts" })], undefined, []],
    ["an edit inside a glob", [call("edit", { filePath: "/repo/src/a/b.ts" })], ["src/**"], []],
    ["an edit outside a glob", [call("edit", { filePath: "/repo/docs/a.md" })], ["src/**"], ["/repo/docs/a.md"]],
    ["a plain directory covers what is beneath it", [call("write", { filePath: "src/a.ts" })], ["./src/"], []],
    [
      "a relative path is resolved against the directory",
      [call("read", { filePath: "lib/x.ts" })],
      ["src"],
      ["/repo/lib/x.ts"],
    ],
    [
      "patch headers are paths",
      [
        call("apply_patch", {
          patchText: "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: test/b.ts\n*** End Patch",
        }),
      ],
      ["src/**"],
      ["/repo/test/b.ts"],
    ],
    [
      "outside the directory only an absolute glob matches",
      [call("read", { filePath: "/etc/hosts" })],
      ["**"],
      ["/etc/hosts"],
    ],
    ["an absolute glob", [call("read", { filePath: "/etc/hosts" })], ["/etc/**"], []],
    [
      "tools without paths are ignored",
      [call("bash", { command: "rm -rf /" }), call("grep", { path: "/x" })],
      ["src/**"],
      [],
    ],
    [
      "a pending call has no settled input yet",
      [call("edit", { filePath: "/repo/docs/a.md" }, "pending")],
      ["src/**"],
      [],
    ],
    ["dot files match wildcards", [call("edit", { filePath: "/repo/src/.env" })], ["src/*"], []],
  ]
  test.each(cases)("%s", (_name, parts, scope, paths) => {
    expect(SubagentReview.scopeViolations(parts, scope, "/repo").map((violation) => violation.path)).toEqual(paths)
  })

  test("reports the tool, the kind of access and the call", () => {
    expect(SubagentReview.scopeViolations([call("read", { filePath: "/repo/x.ts" })], ["src/**"], "/repo")).toEqual([
      { tool: "read", path: "/repo/x.ts", access: "read", callID: "read-call" },
    ])
  })
})

describe("SubagentReview.checkpointDue", () => {
  const cases: Array<[string, Parameters<typeof SubagentReview.checkpointDue>[0], SubagentReview.Checkpoint]> = [
    ["before the interval", { step: 4, last: 0, every: 5, signals: [] }, { type: "none" }],
    ["at the interval", { step: 5, last: 0, every: 5, signals: [] }, { type: "interval" }],
    ["the interval counts from the last checkpoint", { step: 8, last: 5, every: 5, signals: [] }, { type: "none" }],
    [
      "a signal comes first, without repeats",
      { step: 2, last: 0, every: 5, signals: ["scope_violation", "loop_guard", "scope_violation"] },
      { type: "signal", signals: ["scope_violation", "loop_guard"] },
    ],
    ["once a step", { step: 5, last: 5, every: 5, signals: ["loop_guard"] }, { type: "none" }],
    ["an interval of zero is off", { step: 50, last: 0, every: 0, signals: [] }, { type: "none" }],
    ["an infinite interval is off", { step: 50, last: 0, every: Infinity, signals: [] }, { type: "none" }],
    ["no checkpoints left", { step: 9, last: 0, every: 5, signals: ["stall"], remaining: 0 }, { type: "none" }],
  ]
  test.each(cases)("%s", (_name, input, expected) => {
    expect(SubagentReview.checkpointDue(input)).toEqual(expected)
  })
})

describe("SubagentReview.resultStructure", () => {
  const done = (tool: string, input: unknown = {}): SubagentReview.Part => ({
    type: "tool",
    tool,
    state: { status: "completed", input },
  })
  const cases: Array<[string, string, SubagentReview.Part[], string[], boolean, string[]]> = [
    ["an empty result blocks alone", "  ", [], ["tests pass"], true, ["empty_result"]],
    [
      "criteria mentioned",
      "Ran bun test in packages/core: all tests pass.",
      [done("bash")],
      ["bun test passes in packages/core"],
      true,
      [],
    ],
    [
      "a criterion never mentioned",
      "I refactored the parser.",
      [done("edit")],
      ["the migration is reversible"],
      true,
      ["criteria_not_mentioned"],
    ],
    // Mentions are judged on words in any script, not on English keywords.
    [
      "a criterion mentioned in another script",
      "已完成：数据库 迁移 可以 回滚。",
      [done("edit")],
      ["数据库 迁移 可以 回滚"],
      true,
      [],
    ],
    [
      "changes asked, only reads succeeded",
      "Looked at the code; the fix is simple.",
      [done("read")],
      [],
      true,
      ["no_successful_change"],
    ],
    [
      "changes asked, the edit failed",
      "Edited the file.",
      [{ type: "tool", tool: "edit", state: { status: "error" } }],
      [],
      true,
      ["no_successful_change"],
    ],
    ["research only needs no change", "The cache key is built in key.ts.", [done("read")], [], false, []],
  ]
  test.each(cases)("%s", (_name, text, parts, criteria, changesRequested, ids) => {
    expect(
      SubagentReview.resultStructure({ text, parts }, { criteria, changesRequested }).map((finding) => finding.id),
    ).toEqual(ids)
  })

  test("names the criteria it could not find", () => {
    const [finding] = SubagentReview.resultStructure(
      { text: "Updated the docs.", parts: [done("write")] },
      { criteria: ["docs updated", "the changelog has an entry"], changesRequested: true },
    )
    expect(finding?.criteria).toEqual(["the changelog has an entry"])
  })
})
