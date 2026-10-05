import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Glob } from "bun"
import { DesignPrompt } from "@opencode/core/design/prompt"
import { DesignPlaybooks } from "@opencode/core/design/playbooks"

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
      "Review once at the end of each round",
      "Announce “Applying anti-slop” only while this review is running",
      "do not edit, republish or repeatedly audit",
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
      "Record a note you will not change as unresolved or accepted with a reason instead",
      "design_preview refuses to publish while the open round has a note with neither a mark nor an outcome",
      "List them with their marks and outcomes with design_read section notes",
      "Publish and verify once per round, not once per note",
    ])
      expect(prompt).toContain(phrase)
    // The contradictions it replaces: feedback never creates tasks, and outcomes are not recorded twice.
    expect(prompt).not.toContain("Browser feedback creates new Design tasks")
    expect(prompt).not.toContain("record the task and note outcomes")
    // The mark comes before the publish, and the publish before the verify and the outcomes.
    const rounds = prompt.slice(prompt.indexOf("Notes arrive in rounds"))
    expect(rounds.indexOf("design_document update addressed")).toBeLessThan(rounds.indexOf("Then publish one revision"))
    expect(rounds.indexOf("Then publish one revision")).toBeLessThan(rounds.indexOf("design_document update notes"))
    const screen = DesignPlaybooks.render(DesignPlaybooks.find("screen")!)
    expect(screen).toContain("are its checklist")
    expect(screen).toContain("mark it with design_document update addressed")
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

  test("manual anti-slop corrects once while automatic end-of-round review stays report-only", () => {
    expect(DesignPrompt.instructions).toContain(
      "This automatic end-of-round review does not start another development cycle",
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
      "overrides the report-only rule for automatic end-of-round reviews",
    ])
      expect(manual).toContain(phrase)
    const playbook = DesignPlaybooks.render(DesignPlaybooks.find("quality")!)
    expect(playbook).toContain("Automatic end-of-round reviews report findings without starting new edits")
    expect(playbook).toContain(
      "An explicit browser Run anti-slop request instead authorizes one bounded correction pass",
    )
    expect(playbook).toContain("The final audit never starts another correction pass")
  })
})
