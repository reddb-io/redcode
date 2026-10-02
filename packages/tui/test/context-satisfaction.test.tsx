import { expect, test } from "bun:test"
import type { IntelligenceEvaluation } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

for (const scenario of [
  { width: 80, mode: "dual", override: undefined, samples: 0, feedback: "agrees", glyph: "?" },
  { width: 160, mode: "dual", override: undefined, samples: 3, feedback: "agrees", glyph: "▯" },
  { width: 80, mode: "dual", override: undefined, samples: 3, feedback: "rejects", glyph: "█" },
  {
    width: 80,
    mode: "dual",
    override: undefined,
    samples: 6,
    feedback: "rejects",
    continued: true,
    glyph: "█",
  },
  { width: 80, mode: "dual", override: undefined, samples: 3, feedback: "neutral", glyph: "▯" },
  { width: 160, mode: "single", override: "dual", samples: 3, feedback: "agrees", glyph: "▯" },
  { width: 80, mode: "dual", override: "single", samples: 3, feedback: "agrees", glyph: undefined },
] as const) {
  test(`Context aligns temperature to the right at ${scenario.width} columns with ${scenario.override ?? scenario.mode} reasoning and ${scenario.samples} ${scenario.feedback} samples`, async () => {
    await using state = await tmpdir()
    const session = {
      id: "ses_satisfaction",
      projectID: "project",
      title: "Satisfaction layout",
      agent: "build",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      metadata: scenario.override ? { reasoning: scenario.override } : {},
    }
    const evaluations: IntelligenceEvaluation[] = Array.from({ length: scenario.samples }, (_, index) => {
      const feedback = "continued" in scenario && scenario.continued && index >= 3 ? "neutral" : scenario.feedback
      return {
        id: `evaluation_${index}`,
        fingerprint: `prompt_${index}`,
        sessionID: session.id,
        operation: "prompt_classification",
        mode: "dual",
        policy: "fixture",
        decision: "accepted",
        model: "fixture",
        answers: {
          user_feedback: {
            type: "choice",
            choice: feedback,
            probabilities: { [feedback]: 1 },
            confidence: 1,
          },
        },
        issues: [],
        created: index + 1,
        duration: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
      }
    })
    // Observe-only reactions must neither establish a reading nor change a Dual reading.
    evaluations.push(
      ...Array.from(
        { length: 3 },
        (_, index): IntelligenceEvaluation => ({
          id: `observe_${index}`,
          fingerprint: `observe_${index}`,
          sessionID: session.id,
          operation: "prompt_classification",
          mode: "observe",
          policy: "fixture",
          decision: "accepted",
          model: "fixture",
          answers: {
            user_feedback: { type: "choice", choice: "rejects", probabilities: { rejects: 1 }, confidence: 1 },
          },
          issues: [],
          created: index + 100,
          duration: 1,
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      ),
    )
    const statuses: string[] = []
    await using setup = await createAppFixture({
      state: state.path,
      width: scenario.width,
      height: 30,
      args: { sessionID: session.id },
      config: { animations: false, tabs: { mode: "off" }, keybinds: { "session.sidebar.toggle": "f6" } },
      fetch: (url) => {
        if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
        if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
        if (["inbox", "permission", "todo"].some((name) => url.pathname === `/api/session/${session.id}/${name}`))
          return json({ data: [] })
        if (url.pathname === "/api/experimental/intelligence") {
          statuses.push(url.pathname)
          return json({
            settings: { enabled: true, reasoning: scenario.mode, onboarding: "completed" },
            environment: "",
            evaluators: [],
            effective: {
              reasoning: url.searchParams.has("sessionID") ? (scenario.override ?? scenario.mode) : scenario.mode,
              source: "config",
            },
          })
        }
        if (url.pathname === "/api/experimental/intelligence/history") return json(evaluations)
      },
    })
    await setup.ready
    await setup.waitForFrame((frame) => !frame.includes("Opening session") && statuses.length > 0)
    await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-pane")))
    if (scenario.width === 80) setup.mockInput.pressKey("F6")
    await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-sidebar-heading")))
    if (!scenario.glyph) {
      for (let index = 0; index < 5; index++) await setup.renderOnce()
      expect(setup.renderer.root.findDescendantById("session-satisfaction-indicator")).toBeUndefined()
      return
    }
    await setup.waitForFrame((frame) => {
      const indicator = setup.renderer.root.findDescendantById("session-satisfaction-indicator")
      return Boolean(
        indicator &&
          frame.split("\n")[indicator.y]?.slice(indicator.x, indicator.x + indicator.width) === scenario.glyph,
      )
    })
    const heading = setup.renderer.root.findDescendantById("session-sidebar-heading")!
    const indicator = setup.renderer.root.findDescendantById("session-satisfaction-indicator")!
    expect(indicator.y).toBe(heading.y)
    expect(indicator.x).toBeGreaterThan(heading.x + "Context".length)
    expect(indicator.x + indicator.width).toBe(heading.x + heading.width)
    expect(indicator.width).toBe(1)
    expect(indicator.height).toBe(1)
    const row = setup.captureCharFrame().split("\n")[indicator.y]!
    expect(row.slice(indicator.x, indicator.x + indicator.width)).toBe(scenario.glyph)
    expect(row).not.toContain("temp")
    expect(row).not.toMatch(/\d\/5/)
    // Keep the user's existing visibility control in its new location.
    await setup.mockInput.typeText("/satisfaction")
    setup.mockInput.pressEnter()
    await setup.waitForFrame(() => !setup.renderer.root.findDescendantById("session-satisfaction-indicator"))
  })
}
