import { describe, expect, test } from "bun:test"
import { score } from "./score"

describe("delegation evaluation", () => {
  const cases = [
    { id: "review", prompt: "Delegate a review", expected: [{ name: "delegate_task", target: "codex" }] },
    { id: "question", prompt: "Explain delegation", expected: [] },
  ]

  test("scores actual actions, including missing and unsolicited calls", () => {
    const result = score(cases, [
      { id: "review", actions: [{ name: "delegate_task", target: "codex" }] },
      { id: "question", actions: [{ name: "thread_create" }] },
    ])
    expect(result.passed).toBe(1)
    expect(result.entries[1]).toMatchObject({ observed: [{ name: "thread_create" }], passed: false })
    expect(score(cases, []).entries[0]).toMatchObject({ observed: null, passed: false })
    expect(score(cases, [{ id: "review", actions: [{ name: "delegate_task", target: "claude" }] }]).passed).toBe(0)
  })

  test("rejects duplicate and unknown observations", () => {
    expect(() => score(cases, [{ id: "unknown", actions: [] }])).toThrow("Unknown observation")
    expect(() =>
      score(cases, [
        { id: "review", actions: [] },
        { id: "review", actions: [] },
      ]),
    ).toThrow("Duplicate observation")
    expect(() => score([], [])).toThrow()
  })

  test("the checked-in cases validate and require separate council delegates", async () => {
    const fixture = await Bun.file(new URL("./cases.json", import.meta.url)).json()
    const result = score(fixture, [
      {
        id: "council",
        actions: [
          { name: "delegate_task", target: "claude" },
          { name: "delegate_task", target: "codex" },
        ],
      },
    ])
    expect(result.entries.find((entry) => entry.id === "council")?.passed).toBe(true)
    expect(result.passed).toBe(1)
    expect(result.total).toBeGreaterThan(1)
  })
})
