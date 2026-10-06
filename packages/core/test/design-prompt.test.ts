import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Glob } from "bun"
import { DesignPrompt } from "@opencode/core/design/prompt"
import { DesignPlaybooks } from "@opencode/core/design/playbooks"
import { DesignFeedback } from "@opencode/core/design/feedback"
import { Design } from "@opencode/schema/design"
import { Schema } from "effect"

// The Design tools the plugins register, read from their sources so the prompt cannot name a tool that no longer exists.
const registered = async () => {
  const directory = path.join(import.meta.dir, "../src/tool/plugin")
  const files = await Array.fromAsync(new Glob("design-*.ts").scan({ cwd: directory }))
  const sources = await Promise.all(files.map((file) => Bun.file(path.join(directory, file)).text()))
  return new Set(
    sources.flatMap((source) => [...source.matchAll(/name(?: =|:) "(design_[a-z_]+)"/g)].map((match) => match[1])),
  )
}

describe("Design prompt", () => {
  test("names only registered Design tools", async () => {
    const tools = await registered()
    const named = new Set([...DesignPrompt.instructions.matchAll(/\bdesign_[a-z_]+/g)].map((match) => match[0]))
    expect([...named].filter((tool) => !tools.has(tool))).toEqual([])
    for (const tool of [
      "design_document",
      "design_preview",
      "design_export",
      "design_jobs",
      "design_exit",
      "design_history",
    ])
      expect(named.has(tool)).toBe(true)
  })

  test("teaches targets, variants, screens, params and the feedback-round protocol", () => {
    for (const phrase of [
      "web for a responsive frontend, app for a mobile app",
      "presentation for slides",
      'data-design-variant="stable-id"',
      "## Variant operation",
      'data-design-screen="stable-id"',
      'data-design-go="screen-id"',
      "design.params.on(componentID",
      "design.state(componentID, changedFields)",
      "window.__redcodeDesign",
      "kebab-case data-design-id",
      "Every note of the message is listed and none is dropped",
      "read that note in full with design_read section notes, passing its feedback id and note number",
      "Notes arrive in rounds",
      "design_export format verify with round set to the round's number",
      "The anti-slop review is optional and not a step of a round",
      "Announce “Applying anti-slop” only while it runs",
      "Audit findings are reported, never fixed on your own",
      "The fixes the user's notes ask for are always completed",
    ])
      expect(DesignPrompt.instructions).toContain(phrase)
  })

  test("describes one ledger for review notes: mark, publish once, verify once, record", () => {
    const prompt = DesignPrompt.instructions
    for (const phrase of [
      "browser review notes are never Design tasks",
      "the round's notes are your checklist",
      "mark it with design_document update addressed: [{feedback, index, summary}]",
      "a mark is not an outcome and needs no evidence",
      "A note you will not change: record it instead as unresolved or accepted with a reason",
      "it is refused while a note of the round has neither a mark nor an outcome",
      "List them with their marks and outcomes with design_read section notes",
      "Publish and verify once per round, not once per note",
    ])
      expect(prompt).toContain(phrase)
    // The contradictions it replaces: feedback never creates tasks, and outcomes are not recorded twice.
    expect(prompt).not.toContain("Browser feedback creates new Design tasks")
    expect(prompt).not.toContain("record the task and note outcomes")
    // The mark comes before the publish, and the publish before the verify and the outcomes.
    const rounds = prompt.slice(prompt.indexOf("Notes arrive in rounds"))
    expect(rounds.indexOf("design_document update addressed")).toBeLessThan(rounds.indexOf("3. Publish one revision"))
    expect(rounds.indexOf("3. Publish one revision")).toBeLessThan(rounds.indexOf("design_document update notes"))
    const screen = DesignPlaybooks.render(DesignPlaybooks.find("screen")!)
    expect(screen).toContain("are its checklist")
    expect(screen).toContain("mark it with design_document update addressed")
  })

  test("says the six round steps in the same words as the review message", () => {
    const prompt = DesignPrompt.instructions
    const steps = prompt.slice(prompt.indexOf("Finish every round with these steps:")).split("\n").slice(1, 7)
    expect(steps.map((line) => line.slice(0, 3))).toEqual(["1. ", "2. ", "3. ", "4. ", "5. ", "6. "])
    const trailer = DesignFeedback.render(
      Schema.decodeUnknownSync(Design.Feedback)({
        id: "msg_review_1",
        revision: "rev_1",
        text: "",
        items: [{ target: "#title", text: "Make the title larger" }],
        assets: [],
        snapshot: "",
        delivery: "steer",
        end: false,
      }),
      { id: Design.ID.make("design_1"), storage: "/store", round: 1, attachments: [] },
    )
    // Each step opens with the same words in the prompt and in the trailer of a review message.
    for (const [index, opening] of [
      "Fix the notes in the prototype source. After each note or group, mark it",
      "A note you will not change: record it instead",
      "Publish one revision with design_preview; it is refused while a note of the round has neither a mark nor an outcome, and lists those notes.",
      "Run one verify: design_export",
      "Record every note's outcome in ONE",
      "Reply for the",
    ].entries()) {
      expect(steps[index]).toContain(`${index + 1}. ${opening}`)
      expect(trailer).toContain(`${index + 1}. ${opening}`)
    }
  })

  test("stays within its previous size", () => {
    expect(new TextEncoder().encode(DesignPrompt.instructions).length).toBeLessThan(24_967)
  })

  test("keeps the design-system contract and never overwrites product code", () => {
    for (const phrase of [
      "Design-system contract: read .red/DESIGN.md",
      "import components from the listed component roots instead of re-implementing them",
      "Design mode never modifies product files",
      "never replace a product file with prototype HTML",
      "the existing implementation evolves toward it instead of being replaced by prototype markup",
      "sandboxed without same-origin access",
    ])
      expect(DesignPrompt.instructions).toContain(phrase)
  })

  test("manual anti-slop corrects once while any other audit stays report-only and optional", () => {
    expect(DesignPrompt.instructions).toContain(
      "run it only when the user asks (the review page's Run anti-slop, or a typed request) or when design.gate requires an audit before approval",
    )
    const manual = DesignPrompt.instructions.split('A browser request to "Run anti-slop"')[1]!.split("\n\n")[0]!
    for (const phrase of [
      "authorizes one correction pass",
      "optional focus",
      "correct them in the existing prototype source and Session worktree",
      "publish one revision on the same design with design_preview",
      "one final variant-scoped audit of that new revision",
      "If nothing needs correction, do not publish unchanged files",
      "do not start another correction pass",
      "the only case where audit findings are fixed",
    ])
      expect(manual).toContain(phrase)
    const playbook = DesignPlaybooks.render(DesignPlaybooks.find("quality")!)
    expect(playbook).toContain("Findings are reported to the user, never fixed on your own")
    expect(playbook).toContain("it is not a step of a feedback round")
    expect(playbook).not.toContain("For feedback notes, also run one format verify")
    expect(playbook).toContain(
      "An explicit browser Run anti-slop request instead authorizes one bounded correction pass",
    )
    expect(playbook).toContain("The final audit never starts another correction pass")
  })
})
