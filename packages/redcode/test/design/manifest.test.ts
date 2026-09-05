import { describe, expect, test } from "bun:test"
import { empty, parse, serialize, summarize } from "@/design/manifest"

describe("the design manifest", () => {
  test("survives a round trip", () => {
    const manifest = {
      ...empty("hero"),
      decisions: ["one column on mobile", "the price is the headline"],
      questions: ["what happens with no results?"],
    }
    expect(parse(serialize(manifest), "hero")).toEqual(manifest)
  })

  test("a lost manifest never costs a design session", () => {
    // The prototype is the thing that matters. Notes that cannot be read start again rather than
    // stopping the work.
    expect(parse("{ not json", "hero")).toEqual(empty("hero"))
    expect(parse("null", "hero")).toEqual(empty("hero"))
    expect(parse(JSON.stringify({ version: 99, name: "x" }), "hero")).toEqual(empty("hero"))
  })

  test("keeps what it recognises and drops what it does not", () => {
    const parsed = parse(
      JSON.stringify({ version: 1, decisions: ["kept", 42, null], questions: "not a list", extra: "ignored" }),
      "hero",
    )
    expect(parsed.decisions).toEqual(["kept"])
    expect(parsed.questions).toEqual([])
    expect(parsed.name).toBe("hero")
    expect(parsed.entry).toBe("index.html")
  })

  test("hands the plan the reasoning, not the markup", () => {
    const text = summarize(
      { ...empty("hero"), decisions: ["one column on mobile"], questions: ["empty state?"] },
      ".redcode/designs/1-hero",
    )
    expect(text).toContain("Prototype: .redcode/designs/1-hero")
    expect(text).toContain("- one column on mobile")
    expect(text).toContain("Still open:")
    expect(text).toContain("- empty state?")
  })

  test("says nothing rather than empty headings when the conversation settled nothing", () => {
    const text = summarize(empty("hero"), "p")
    expect(text).not.toContain("Decided:")
    expect(text).not.toContain("Still open:")
  })
})
