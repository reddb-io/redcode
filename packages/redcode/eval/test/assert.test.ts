import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Expectations } from "../lib/assert"
import { EvalRecord, type RunRecord } from "../lib/record"

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    ...EvalRecord.build({
      eval: "e",
      model: "m",
      mode: "scripted",
      hermetic: false,
      durationMs: 1200,
      guards: [],
      messages: [
        {
          info: { role: "assistant", agent: "build" },
          parts: [
            { type: "tool", tool: "bash", callID: "1", state: { status: "error", input: { command: "sh test.sh" }, error: "exit 1" } },
            { type: "tool", tool: "bash", callID: "2", state: { status: "completed", input: { command: "sh test.sh" }, output: "PASS" } },
            { type: "tool", tool: "read", callID: "3", state: { status: "completed", input: { filePath: "a" }, output: "x" } },
            { type: "text", text: "All tests pass now." },
            { type: "step-finish", cost: 0.02, tokens: { input: 1000, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } },
          ],
        },
      ],
    }),
    ...overrides,
  }
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "eval-assert-"))
fs.writeFileSync(path.join(workspace, "notes.md"), "welcome world\n")

describe("expectations", () => {
  test("tool call checks count, filter by predicate and status, and name the tools seen on failure", () => {
    const run = new Expectations(record(), { workspace })
    run.toolCalled("bash", (input) => input.command === "sh test.sh", { times: 2 })
    run.toolCalled("bash", undefined, { status: "completed", times: 1 })
    run.toolCalled("edit")
    run.toolNotCalled("write")
    run.toolNotCalled("read")
    // A predicate that throws counts as no match instead of breaking the run.
    run.toolCalled("read", (input) => input.missing.deep === 1)
    expect(run.results.map((item) => item.pass)).toEqual([true, true, false, true, false, false])
    expect(run.results[2]!.message).toContain("tools used: bash, read")
  })

  test("budget checks: cost, time, steps; an unmeasured run never passes a cost ceiling", () => {
    const run = new Expectations(record(), { workspace })
    run.costAtMost(0.05).costAtMost(0.01).finishedWithin(2000).finishedWithin(1000).stepsAtMost(1).stepsAtMost(0)
    expect(run.results.map((item) => item.pass)).toEqual([true, false, true, false, true, false])
    const unmeasured = new Expectations(record({ cost: null, outcome: "unmeasured" }), { workspace })
    unmeasured.costAtMost(100).completed()
    expect(unmeasured.results.map((item) => item.pass)).toEqual([false, false])
    expect(unmeasured.results[0]!.message).toContain("unmeasured")
  })

  test("guards: stops fail by default, any event fails strict", () => {
    const guards = [{ guard: "evidence", action: "correct" as const, detail: "refused" }]
    const run = new Expectations(record({ guards }), { workspace })
    run.noGuardStops().noGuardStops({ strict: true }).guardFired("evidence", "correct").guardFired("loop")
    expect(run.results.map((item) => item.pass)).toEqual([true, false, true, false])
  })

  test("mentions and fileContains accept strings and patterns", () => {
    const run = new Expectations(record(), { workspace })
    run.mentions("tests pass").mentions(/PASS/).fileContains("notes.md", /^welcome/).fileContains("notes.md", "hello").fileContains("missing.md", "x")
    expect(run.results.map((item) => item.pass)).toEqual([true, false, true, false, false])
    expect(run.failures).toHaveLength(3)
  })

  test("check runs a workspace command and passes on exit 0", async () => {
    const run = new Expectations(record(), { workspace })
    await run.check("grep -q welcome notes.md")
    await run.check("grep -q hello notes.md")
    expect(run.results.map((item) => item.pass)).toEqual([true, false])
    const seen: string[] = []
    const injected = new Expectations(record(), {
      workspace,
      exec: async (command, cwd) => {
        seen.push(`${cwd}:${command}`)
        return { exitCode: 3, output: "boom" }
      },
    })
    await injected.check("make verify")
    expect(seen).toEqual([`${workspace}:make verify`])
    expect(injected.results[0]).toMatchObject({ pass: false, message: "exit 3: boom" })
  })
})
