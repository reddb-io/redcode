import { describe, expect, test } from "bun:test"
import { ConfigMarkdown } from "@opencode/core/config/markdown"

describe("ConfigMarkdown.parse", () => {
  test("recovers a frontmatter value that starts with a bracketed tag", () => {
    const parsed = ConfigMarkdown.parse("---\ndescription: [Team] Does a thing\ntools: [read, edit]\n---\nbody")
    expect(parsed.data.description).toBe("[Team] Does a thing")
    expect(parsed.data.tools).toEqual(["read", "edit"])
  })
})
