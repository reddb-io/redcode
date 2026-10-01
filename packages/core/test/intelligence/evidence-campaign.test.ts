import { describe, expect, test } from "bun:test"
import { SessionTaskFacts } from "@opencode/core/session/task-facts"
import { IntelligenceClassification } from "@opencode/core/intelligence/classification"
import { tool } from "./fixtures"

// Split by family before thresholds are changed. No model calls or paid inference run here.
const edits = [
  {
    id: "read-before-edit",
    family: "ordered",
    split: "calibration",
    before: "read",
    after: "edit",
    paths: ["a.ts", "a.ts"],
    fresh: false,
  },
  {
    id: "read-other-file",
    family: "ordered",
    split: "calibration",
    before: "read",
    after: "edit",
    paths: ["a.ts", "b.ts"],
    fresh: true,
  },
  {
    id: "check-before-edit",
    family: "ordered",
    split: "calibration",
    before: "bash",
    after: "edit",
    paths: ["a.ts", "a.ts"],
    fresh: false,
  },
  {
    id: "check-after-edit",
    family: "ordered",
    split: "calibration",
    before: "edit",
    after: "bash",
    paths: ["a.ts", "a.ts"],
    fresh: true,
    inspect: 1,
  },
  {
    id: "failed-edit",
    family: "ordered",
    split: "calibration",
    before: "read",
    after: "edit",
    paths: ["a.ts", "a.ts"],
    fresh: true,
    error: "not found",
  },
  {
    id: "running-edit",
    family: "ordered",
    split: "calibration",
    before: "read",
    after: "edit",
    paths: ["a.ts", "a.ts"],
    fresh: false,
    pending: true,
  },
  {
    id: "windows-case",
    family: "platform",
    split: "heldout",
    before: "read",
    after: "edit",
    paths: ["C:\\Project\\A.ts", "c:/project/a.ts"],
    fresh: false,
  },
  {
    id: "parallel-completion",
    family: "parallel",
    split: "heldout",
    before: "read",
    after: "edit",
    paths: ["a.ts", "a.ts"],
    fresh: true,
    reverseTime: true,
  },
  {
    id: "unknown-scope",
    family: "unknown",
    split: "heldout",
    before: "bash",
    after: "edit",
    paths: ["", ""],
    fresh: false,
  },
  {
    id: "patch-file",
    family: "patch",
    split: "heldout",
    before: "read",
    after: "apply_patch",
    paths: ["a.ts", "a.ts"],
    fresh: false,
  },
  {
    id: "design-same",
    family: "design",
    split: "heldout",
    before: "design_preview",
    after: "design_edit",
    paths: ["d1", "d1"],
    fresh: false,
  },
  {
    id: "design-other",
    family: "design",
    split: "heldout",
    before: "design_preview",
    after: "design_edit",
    paths: ["d1", "d2"],
    fresh: true,
  },
] as const
const continuations = [
  { id: "continue", family: "followup", split: "calibration", text: "continue" },
  { id: "ok", family: "followup", split: "calibration", text: "ok" },
  { id: "go", family: "followup", split: "calibration", text: "go" },
  { id: "pronto", family: "followup", split: "calibration", text: "pronto, siga" },
  { id: "compacted", family: "checkpoint", split: "heldout", text: "continue após compaction" },
  { id: "moved", family: "placement", split: "heldout", text: "continue na worktree temporária" },
  { id: "pending", family: "steering", split: "heldout", text: "antes disso, corrija a autenticação" },
  { id: "reference", family: "reference", split: "heldout", text: "implemente a terceira opção" },
] as const

describe("offline evidence campaign", () => {
  test("keeps ten calibration and ten held-out cases without a shared family", () => {
    const cases = [...edits, ...continuations]
    const calibration = cases.filter((item) => item.split === "calibration")
    const heldout = cases.filter((item) => item.split === "heldout")
    expect(calibration).toHaveLength(10)
    expect(heldout).toHaveLength(10)
    expect(heldout.some((item) => calibration.some((before) => before.family === item.family))).toBe(false)
  })

  edits.forEach((fixture) =>
    test(`${fixture.split}: ${fixture.id}`, () => {
      const input = (name: string, path: string) =>
        name.startsWith("design_")
          ? { id: path }
          : name === "bash"
            ? { command: "bun test" }
            : name === "apply_patch"
              ? { patchText: `*** Update File: ${path}\n@@\n-a\n+b` }
              : { filePath: path }
      const results = SessionTaskFacts.project(
        [
          tool("msg_before", fixture.before, input(fixture.before, fixture.paths[0]), {
            exit: 0,
            completed: "reverseTime" in fixture ? 3 : 1,
          }),
          tool("msg_after", fixture.after, input(fixture.after, fixture.paths[1]), {
            exit: 0,
            completed: 2,
            ...("error" in fixture ? { error: fixture.error } : {}),
            ...("pending" in fixture ? { pending: fixture.pending } : {}),
          }),
        ],
        "/project",
      )
      const call = SessionTaskFacts.evidence(results).calls["inspect" in fixture ? fixture.inspect : 0]!
      expect(call.fresh).toBe(fixture.fresh)
      expect(call.callID).toBe(`call_${call.messageID}`)
      expect(call.hash).toHaveLength(64)
    }),
  )

  continuations.forEach((fixture) =>
    test(`${fixture.split}: ${fixture.id}`, () => {
      const request = IntelligenceClassification.evaluation({
        sessionID: "ses_fixture",
        request: { id: fixture.id, text: fixture.text },
        history: [],
        omitted: 100,
        session: {
          mode: "build",
          goal: "Ship Design feedback",
          plan: "Implement API then CLI",
          continuation: {
            location: { directory: "/tmp/worktree" },
            tasks: [{ content: "Verify feedback", status: "pending" }],
            originalRequest: "Keep the draft when feedback fails",
            priorDecision: "local_change",
            pending: "Fix auth first",
          },
        },
        skills: [],
        scrub: (text) => text,
      })
      const source = JSON.stringify(request.sources)
      for (const expected of [
        fixture.text,
        "Ship Design feedback",
        "Verify feedback",
        "/tmp/worktree",
        "local_change",
        "Fix auth first",
        "Keep the draft",
      ])
        expect(source).toContain(expected)
    }),
  )
})
