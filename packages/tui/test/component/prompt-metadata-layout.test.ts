import { describe, expect, test } from "bun:test"
import { promptMetadataLayout, promptMetadataWidth } from "../../src/component/prompt/metadata-layout"

const line = (width: number, terminalWidth = width + 13) =>
  promptMetadataLayout({
    width,
    terminalWidth,
    agent: "Build",
    auto: true,
    model: "Gemini 3.7 Flash",
    variant: "high",
    s1: { model: "JEV 1.13 with a much longer evaluator name", provider: "RedRouter" },
    provider: "RedRouter»Antigravity",
  })

describe("prompt metadata layout", () => {
  test("shows the whole compact line with the route hint when the terminal has spare width", () => {
    expect(line(160)).toEqual({
      agent: "Build",
      auto: true,
      model: "Gemini 3.7 Flash",
      variant: "high",
      s1: "JEV 1.13 with a much longer evaluator name",
      route: "RedRouter»Antigravity · RedRouter",
    })
  })

  test("never shows the route hint below 100 columns, even when it would fit", () => {
    expect(line(200, 99).route).toBeUndefined()
  })

  test("drops the route hint before the S1 name truncates", () => {
    const layout = line(80, 120)
    expect(layout.route).toBeUndefined()
    expect(layout.s1).toBe("JEV 1.13 with a much longer evaluator name")
  })

  test("truncates the S1 name, then drops it, but never shortens the S2 model", () => {
    const truncated = line(70)
    expect(truncated.s1).toBe("JEV 1.13 with a much lo…")
    expect(truncated.model).toBe("Gemini 3.7 Flash")

    const narrow = line(50)
    expect(narrow.s1).toBe("JEV 1.13 wi…")
    expect(narrow.model).toBe("Gemini 3.7 Flash")

    const gone = line(48)
    expect(gone.s1).toBeUndefined()
    expect(gone.auto).toBe(true)
    expect(gone.model).toBe("Gemini 3.7 Flash")

    const tiny = line(10, 30)
    expect(tiny).toEqual({ model: "Gemini 3.7 Flash", variant: "high" })
  })

  test("every chosen layout fits the width it was given, unless only the model is left", () => {
    for (const width of [20, 30, 40, 50, 60, 70, 80, 100, 140]) {
      const layout = line(width)
      if (layout.agent) expect(promptMetadataWidth(layout)).toBeLessThanOrEqual(width)
    }
  })

  test("names the S1 setup hint when dual reasoning has no evaluator yet", () => {
    const layout = promptMetadataLayout({
      width: 80,
      terminalWidth: 93,
      agent: "Build",
      auto: false,
      model: "Gemini 3.7 Flash",
      s1: { model: "S1 setup", provider: "" },
      provider: "Anthropic",
    })
    expect(layout.s1).toBe("S1 setup")
    expect(layout.route).toBeUndefined()
  })
})
