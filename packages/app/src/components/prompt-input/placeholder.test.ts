import { describe, expect, test } from "bun:test"
import { promptDesignPlaceholder, promptPlaceholder } from "./placeholder"

describe("promptPlaceholder", () => {
  test("returns shell placeholder in shell mode", () => {
    const value = promptPlaceholder({
      mode: "shell",
      commentCount: 0,
      example: "example",
      suggest: true,
    })
    expect(value).toBe("Enter shell command... example")
  })

  test("returns summarize placeholders for comment context", () => {
    expect(promptPlaceholder({ mode: "normal", commentCount: 1, example: "example", suggest: true })).toBe(
      "Summarize comment…",
    )
    expect(promptPlaceholder({ mode: "normal", commentCount: 2, example: "example", suggest: true })).toBe(
      "Summarize comments…",
    )
  })

  test("returns default placeholder with example when suggestions enabled", () => {
    const value = promptPlaceholder({
      mode: "normal",
      commentCount: 0,
      example: "translated-example",
      suggest: true,
    })
    expect(value).toBe('Ask anything... "translated-example"')
  })

  test("returns simple placeholder when suggestions disabled", () => {
    const value = promptPlaceholder({
      mode: "normal",
      commentCount: 0,
      example: "example",
      suggest: false,
    })
    expect(value).toBe("Ask anything...")
  })
})
