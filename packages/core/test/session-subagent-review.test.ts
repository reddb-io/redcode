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
  const cases: Array<[string, SubagentReview.BriefInput, SubagentReview.BriefIssue[], boolean]> = [
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

describe("SubagentReview.resultStructure", () => {
  const done = (tool: string, input: unknown = {}): SubagentReview.Part => ({
    type: "tool",
    tool,
    state: { status: "completed", input },
  })
  const cases: Array<[string, string, SubagentReview.Part[], string[], boolean, SubagentReview.ResultIssue[]]> = [
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

const shell = (command: string, exit: number | undefined, status = "completed"): SubagentReview.Part => ({
  type: "tool",
  tool: "bash",
  state: {
    status,
    input: { command },
    ...(status === "error" ? { error: "boom" } : { output: `ran ${command}` }),
    ...(exit === undefined ? {} : { metadata: { exit } }),
  },
})

const accepted = { id: "eval_1", decision: "accepted" as const, issues: [] }

describe("SubagentReview.supervised", () => {
  const brief: SubagentReview.Brief = {
    brief: "do it",
    agent: "general",
    scope: [],
    criteria: [],
    writeCapable: true,
    parentSessionID: "ses_parent",
    verdict: "verified",
    issues: [],
    created: 1,
  }
  const cases: Array<[string, SubagentReview.Brief | undefined, boolean]> = [
    ["no brief", undefined, false],
    ["a brief without structure", brief, false],
    ["a brief with scope", { ...brief, scope: ["src/**"] }, true],
    ["a brief with criteria", { ...brief, criteria: ["tests pass"] }, true],
    ["a brief with a return format", { ...brief, returnFormat: "a list" }, true],
    ["a blank return format", { ...brief, returnFormat: "  " }, false],
    // A brief the user wrote is not reviewed on the way in, nor on the way out.
    ["a skipped brief", { ...brief, criteria: ["tests pass"], verdict: "skipped" }, false],
    ["an unverified brief", { ...brief, criteria: ["tests pass"], verdict: "unverified" }, true],
  ]
  test.each(cases)("%s", (_name, input, expected) => {
    expect(SubagentReview.supervised(input)).toBe(expected)
  })

  test("the result verdict round-trips through metadata; a malformed one is dropped", () => {
    const result: SubagentReview.ResultReview = { decision: "verified", issues: [], repaired: true }
    const metadata = SubagentReview.toMetadata(undefined, { ...brief, result })
    expect(SubagentReview.fromMetadata(metadata)?.result).toEqual(result)
    const malformed = SubagentReview.toMetadata(undefined, {
      ...brief,
      result: { decision: "great", issues: [], repaired: false } as unknown as SubagentReview.ResultReview,
    })
    expect(SubagentReview.fromMetadata(malformed)?.result).toBeUndefined()
  })
})

describe("SubagentReview.failingVerifications", () => {
  const cases: Array<[string, SubagentReview.Part[], string[]]> = [
    ["a passing command", [shell("bun test", 0)], []],
    ["a failing command", [shell("bun test", 1)], ["bun test"]],
    ["the last run wins: failed then passed", [shell("bun test", 1), shell("bun test", 0)], []],
    ["the last run wins: passed then failed", [shell("bun test", 0), shell("bun test", 2)], ["bun test"]],
    ["an errored command", [shell("bun run build", undefined, "error")], ["bun run build"]],
    // A search with no match exits 1 and proves nothing either way.
    ["a read-only command", [shell("grep -rn foo src", 1)], []],
    ["no exit code recorded", [shell("bun test", undefined)], []],
    ["not a shell", [{ type: "tool", tool: "edit", state: { status: "error", input: {} } }], []],
  ]
  test.each(cases)("%s", (_name, parts, commands) => {
    expect(SubagentReview.failingVerifications(parts).map((run) => run.command)).toEqual(commands)
  })
})

describe("SubagentReview.resultChecks", () => {
  const edit = (path: string): SubagentReview.Part => ({
    type: "tool",
    tool: "edit",
    state: { status: "completed", input: { filePath: path }, output: "ok" },
  })
  const cases: Array<[string, string, SubagentReview.Part[], SubagentReview.ResultCheck[], boolean]> = [
    [
      "a clean result",
      "Fixed src/cache/key.ts; bun test passes.",
      [edit("/repo/src/cache/key.ts"), shell("bun test", 0)],
      [],
      false,
    ],
    ["an empty result blocks", " ", [edit("/repo/src/cache/key.ts")], ["empty_result"], true],
    [
      "a change outside the scope blocks",
      "Fixed src/cache/key.ts; bun test passes.",
      [edit("/repo/src/cache/key.ts"), edit("/repo/src/db/pool.ts"), shell("bun test", 0)],
      ["out_of_scope"],
      true,
    ],
    [
      "a failing check is reported but does not block",
      "Fixed src/cache/key.ts; bun test passes.",
      [edit("/repo/src/cache/key.ts"), shell("bun test", 1)],
      ["failing_verification"],
      false,
    ],
    [
      "reading outside the scope is fine",
      "Fixed src/cache/key.ts; bun test passes.",
      [
        { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/repo/src/db/pool.ts" } } },
        edit("/repo/src/cache/key.ts"),
        shell("bun test", 0),
      ],
      [],
      false,
    ],
  ]
  test.each(cases)("%s", (_name, text, parts, ids, blocking) => {
    const findings = SubagentReview.resultChecks(
      { text, parts },
      { criteria: ["bun test passes"], scope: ["src/cache/**"], changesRequested: true, directory: "/repo" },
    )
    expect(findings.map((finding) => finding.id)).toEqual(ids)
    expect(findings.some((finding) => finding.blocking)).toBe(blocking)
  })

  test("names the files changed outside the scope and the exit codes of failing commands", () => {
    const findings = SubagentReview.resultChecks(
      { text: "bun test passes", parts: [edit("/repo/src/db/pool.ts"), shell("bun test", 3)] },
      { criteria: ["bun test passes"], scope: ["src/cache/**"], changesRequested: true, directory: "/repo" },
    )
    expect(findings.find((finding) => finding.id === "out_of_scope")?.message).toContain("/repo/src/db/pool.ts")
    expect(findings.find((finding) => finding.id === "failing_verification")?.message).toContain("bun test (exit 3)")
  })
})

describe("SubagentReview.digest", () => {
  test("keeps settled calls with their command or files, exit code and the tail of the output", () => {
    const result = SubagentReview.digest(
      [
        { type: "text" },
        { type: "tool", tool: "bash", state: { status: "running", input: { command: "bun test" } } },
        shell("bun test", 1),
        {
          type: "tool",
          tool: "edit",
          state: { status: "completed", input: { filePath: "src/a.ts" }, output: "x".repeat(1000) },
        },
        { type: "tool", tool: "edit", state: { status: "error", input: { filePath: "src/b.ts" }, error: "no match" } },
      ],
      { directory: "/repo" },
    )
    expect(result.total).toBe(3)
    expect(result.omitted).toBe(0)
    expect(result.calls[0]).toEqual({
      tool: "bash",
      status: "completed",
      command: "bun test",
      exit: 1,
      output: "ran bun test",
    })
    expect(result.calls[1]?.files).toEqual(["/repo/src/a.ts"])
    // Bounded: the tail of a long output, in code points.
    expect([...(result.calls[1]?.output ?? "")].length).toBe(401)
    expect(result.calls[2]).toMatchObject({ status: "error", output: "no match" })
  })

  test("keeps the most recent calls and counts the rest", () => {
    const parts = Array.from({ length: 50 }, (_, index) => shell(`bun test ${index}`, 0))
    const result = SubagentReview.digest(parts, { calls: 10 })
    expect(result.total).toBe(50)
    expect(result.omitted).toBe(40)
    expect(result.calls.map((call) => call.command)).toEqual(
      Array.from({ length: 10 }, (_, index) => `bun test ${40 + index}`),
    )
  })
})

describe("SubagentReview.judge", () => {
  const advice = { id: "criteria_not_mentioned", blocking: false, message: "The result does not mention a criterion" }
  const blocking = { id: "out_of_scope", blocking: true, message: "Changed files outside the scope" }
  const cases: Array<
    [string, Parameters<typeof SubagentReview.judge>[0], SubagentReview.ResultDecision, ReadonlyArray<string>]
  > = [
    [
      "single reasoning is unverified, whatever the findings",
      { findings: [advice], single: true, repaired: false },
      "unverified",
      ["criteria_not_mentioned"],
    ],
    ["S1 accepts", { findings: [advice], evaluation: accepted, single: false, repaired: false }, "verified", []],
    [
      "S1 needs revision",
      {
        findings: [],
        evaluation: { id: "e", decision: "needs_revision", issues: ["unmet_criterion"] },
        single: false,
        repaired: false,
      },
      "needs_revision",
      ["unmet_criterion"],
    ],
    [
      "S1 inconclusive only annotates",
      {
        findings: [],
        evaluation: { id: "e", decision: "inconclusive", issues: ["claim_without_evidence"] },
        single: false,
        repaired: true,
      },
      "inconclusive",
      ["claim_without_evidence"],
    ],
    [
      "a blocking finding needs revision without S1",
      { findings: [blocking], single: false, repaired: false },
      "needs_revision",
      ["out_of_scope"],
    ],
    [
      "a blocking finding overrides an S1 accept",
      { findings: [blocking], evaluation: accepted, single: false, repaired: false },
      "needs_revision",
      ["out_of_scope"],
    ],
    [
      "S1 unavailable fails open, labelled",
      {
        findings: [advice],
        evaluation: {
          id: "e",
          decision: "unavailable",
          issues: ["Evaluation unavailable: 503. Previous state preserved."],
        },
        single: false,
        repaired: false,
      },
      "unverified",
      ["criteria_not_mentioned"],
    ],
    ["S1 not enabled fails open", { findings: [], single: false, repaired: false }, "unverified", []],
  ]
  test.each(cases)("%s", (_name, input, decision, issues) => {
    const review = SubagentReview.judge(input)
    expect(review.decision).toBe(decision)
    expect(review.issues).toEqual(issues)
    expect(review.repaired).toBe(input.repaired)
  })

  test("an unavailable S1 says why, without the gate wording", () => {
    const review = SubagentReview.judge({
      findings: [],
      evaluation: {
        id: "e",
        decision: "unavailable",
        issues: ["Evaluation unavailable: 503. Previous state preserved."],
      },
      single: false,
      repaired: false,
    })
    expect(review.unavailable).toBe("Evaluation unavailable: 503.")
  })
})

describe("SubagentReview.repair and reviewBlock", () => {
  test("the repair message opens with its marker and asks for each issue once", () => {
    const text = SubagentReview.repair({
      issues: ["unmet_criterion", "0:unmet_criterion", "out_of_scope"],
      findings: [{ id: "out_of_scope", blocking: true, message: "Changed src/db/pool.ts" }],
    })
    expect(text.startsWith(SubagentReview.REPAIR)).toBe(true)
    expect(text).toContain("Changed src/db/pool.ts")
    expect(text.split("Meet every done criterion").length).toBe(2)
    expect(text).toContain("only repair round")
  })

  const cases: Array<[string, SubagentReview.ResultReview, ReadonlyArray<string>]> = [
    [
      "verified",
      { decision: "verified", issues: [], repaired: false, evaluationID: "e1" },
      ['<review decision="verified">', "e1", "no gap"],
    ],
    [
      "needs revision after the repair",
      { decision: "needs_revision", issues: ["unmet_criterion"], repaired: true },
      [
        '<review decision="needs_revision" repaired="true">',
        "unmet_criterion",
        "after one repair round",
        "re-delegate",
      ],
    ],
    [
      "inconclusive",
      { decision: "inconclusive", issues: ["claim_without_evidence"], repaired: false },
      ["claim_without_evidence", "Check the claims"],
    ],
    [
      "unverified in single reasoning",
      { decision: "unverified", issues: [], repaired: false },
      [Intelligence.UNVERIFIED, "mechanical checks", "unchecked"],
    ],
    [
      "unverified because S1 failed",
      { decision: "unverified", issues: [], repaired: false, unavailable: "Evaluation unavailable: 503." },
      ["S1 could not review the result (Evaluation unavailable: 503.)", "unchecked"],
    ],
  ]
  test.each(cases)("%s", (_name, review, fragments) => {
    const block = SubagentReview.reviewBlock(review)
    expect(block.endsWith("</review>")).toBe(true)
    for (const fragment of fragments) expect(block).toContain(fragment)
  })

  test("the result questions are yes-is-an-error noul questions", () => {
    expect(Object.keys(SubagentReview.resultQuestions)).toEqual([
      "unmet_criterion",
      "claim_without_evidence",
      "out_of_scope",
      "missing_output",
      "contradicts_brief",
    ])
    for (const question of Object.values(SubagentReview.resultQuestions)) expect(question.type).toBe("noul")
  })
})
