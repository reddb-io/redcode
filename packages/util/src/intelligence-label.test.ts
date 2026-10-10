import { describe, expect, test } from "bun:test"
import { IntelligenceLabel } from "./intelligence-label.js"

describe("IntelligenceLabel", () => {
  test("reads an outcome only from dual evaluations worth mentioning", () => {
    const dual = { mode: "dual", historyFailed: false }

    expect(IntelligenceLabel.outcome({ ...dual, decision: "needs_revision" })).toBe("needs_revision")
    expect(IntelligenceLabel.outcome({ ...dual, decision: "inconclusive" })).toBe("inconclusive")
    expect(IntelligenceLabel.outcome({ ...dual, decision: "approved" })).toBeUndefined()
    expect(IntelligenceLabel.outcome({ ...dual, decision: undefined })).toBeUndefined()
    // Unreadable history is an outage only in dual mode.
    expect(IntelligenceLabel.outcome({ mode: "dual", historyFailed: true, decision: undefined })).toBe("unavailable")
    expect(IntelligenceLabel.outcome({ mode: "observe", historyFailed: true, decision: "unavailable" })).toBeUndefined()
    expect(
      IntelligenceLabel.outcome({ mode: "single", historyFailed: false, decision: "needs_revision" }),
    ).toBeUndefined()
  })

  test.each([
    {
      name: "a failed status read",
      failed: true,
      onboarding: undefined,
      mode: undefined,
      outcome: undefined,
      state: "offline",
    },
    {
      name: "a loading status",
      failed: false,
      onboarding: undefined,
      mode: "dual",
      outcome: undefined,
      state: undefined,
    },
    {
      name: "pending roles",
      failed: false,
      onboarding: "pending",
      mode: "dual",
      outcome: "unavailable",
      state: "setup",
    },
    {
      name: "deferred roles",
      failed: false,
      onboarding: "deferred",
      mode: "single",
      outcome: undefined,
      state: "setup",
    },
    {
      name: "observation",
      failed: false,
      onboarding: "completed",
      mode: "observe",
      outcome: undefined,
      state: "observing",
    },
    {
      name: "an outage",
      failed: false,
      onboarding: "completed",
      mode: "dual",
      outcome: "unavailable",
      state: "unavailable",
    },
    {
      name: "an unsure S1",
      failed: false,
      onboarding: "completed",
      mode: "dual",
      outcome: "inconclusive",
      state: "unsure",
    },
    {
      name: "a flagged answer",
      failed: false,
      onboarding: "completed",
      mode: "dual",
      outcome: "needs_revision",
      state: "flagged",
    },
    {
      name: "a quiet dual session",
      failed: false,
      onboarding: "completed",
      mode: "dual",
      outcome: undefined,
      state: undefined,
    },
    {
      name: "single mode",
      failed: false,
      onboarding: "completed",
      mode: "single",
      outcome: undefined,
      state: undefined,
    },
  ] as const)("says $state for $name", (row) => {
    expect(IntelligenceLabel.state(row)).toBe(row.state)
  })

  test("keeps the warning tone for real outages", () => {
    expect(IntelligenceLabel.tone({ failed: true, outcome: undefined })).toBe("warning")
    expect(IntelligenceLabel.tone({ failed: false, outcome: "unavailable" })).toBe("warning")
    expect(IntelligenceLabel.tone({ failed: false, outcome: "needs_revision" })).toBe("info")
    expect(IntelligenceLabel.tone({ failed: false, outcome: undefined })).toBe("muted")
  })

  test("names evaluators as people know them", () => {
    expect(IntelligenceLabel.transportName("red-router")).toBe("RedRouter")
    expect(IntelligenceLabel.transportName("custom")).toBe("custom")
    expect(IntelligenceLabel.modelName("vendor/jev-mini")).toBe("JEV mini")
    expect(IntelligenceLabel.modelName("gpt-5-mini")).toBe("gpt-5-mini")
  })
})
