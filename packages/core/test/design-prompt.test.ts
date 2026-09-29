import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Glob } from "bun"
import { DesignPrompt } from "@opencode/core/design/prompt"

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
      "Notes arrive in rounds",
      "design_export format verify with round set to the round's number",
      "Limit automatic correction to two cycles",
    ])
      expect(DesignPrompt.instructions).toContain(phrase)
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
})
