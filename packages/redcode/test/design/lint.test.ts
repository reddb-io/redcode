import { describe, expect, test } from "bun:test"
import { DesignLint } from "@/design/lint"

const ids = (html: string) => DesignLint.lint(html).map((f) => f.id)

describe("design lint", () => {
  test("a plain page passes", () => {
    expect(
      ids(`<style>:root{--accent:#b0413e}.card{border:1px solid #ddd;border-radius:4px}</style><h1>Settings</h1>`),
    ).toEqual([])
  })

  test("purple gradient, by hex and by keyword", () => {
    expect(ids(`<div style="background:linear-gradient(90deg,#6366f1,#a855f7)">`)).toEqual(["purple-gradient"])
    expect(ids(`<div style="background:linear-gradient(to right, purple, white)">`)).toEqual(["purple-gradient"])
  })

  test("blue→cyan trust gradient, only when both ends are present", () => {
    expect(ids(`<div style="background:linear-gradient(90deg,#3b82f6,#06b6d4)">`)).toEqual(["trust-gradient"])
    expect(ids(`<div style="background:linear-gradient(90deg,#3b82f6,#1e3a8a)">`)).toEqual([])
  })

  test("default indigo as a solid, unless the design system declares it", () => {
    expect(ids(`<style>.btn{background:#6366f1}</style>`)).toEqual(["default-indigo"])
    expect(ids(`<style>:root{--accent:#6366f1}.btn{background:var(--accent)}</style>`)).toEqual([])
    // laundered through another token name still counts
    expect(ids(`<style>:root{--primary:#6366f1}.btn{background:var(--primary)}</style>`)).toEqual(["default-indigo"])
  })

  test("emoji only when it stands in for an icon", () => {
    expect(ids(`<li>🚀 Fast deploys</li>`)).toEqual(["emoji-icon"])
    expect(ids(`<p>She said the launch went 🚀 well.</p>`)).toEqual([])
  })

  test("the rounded left-accent card", () => {
    expect(ids(`<style>.tip{border-left:4px solid #b0413e;border-radius:8px}</style>`)).toEqual(["left-accent-card"])
    expect(ids(`<style>.tip{border-left:4px solid #b0413e;border-radius:0}</style>`)).toEqual([])
  })

  test("invented metrics and filler copy", () => {
    expect(ids(`<p>10× faster than before</p>`)).toEqual(["invented-metric"])
    expect(ids(`<p>Lorem ipsum dolor</p>`)).toEqual(["filler-copy"])
  })

  test("scrollIntoView", () => {
    expect(ids(`<script>el.scrollIntoView()</script>`)).toEqual(["scroll-into-view"])
  })

  test("examples inside HTML comments do not fire", () => {
    expect(ids(`<!-- e.g. linear-gradient(#6366f1, #a855f7) --><h1>Hi</h1>`)).toEqual([])
  })

  test("the report reads as one note per finding, or nothing", () => {
    expect(DesignLint.report([])).toBeUndefined()
    const text = DesignLint.report(DesignLint.lint(`<p>Lorem ipsum</p>`))
    expect(text).toContain("Craft notes (1)")
    expect(text).toContain("- filler-copy:")
  })
})
