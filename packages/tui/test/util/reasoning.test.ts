import { describe, expect, test } from "bun:test"
import { appliedLabel, compactVariantLabel, reasoningLabel } from "../../src/util/reasoning"

describe("util.reasoning", () => {
  test("says which level an auto session runs at, why, and who chose it", () => {
    expect(reasoningLabel({ reasoning: { level: "high", cause: "frustration", decider: "redcode" } })).toBe(
      "auto → high · frustration",
    )
    expect(reasoningLabel({ reasoning: { level: "xhigh", cause: "loop_guard", decider: "redcode" } })).toBe(
      "auto → xhigh · loop guard",
    )
    // Where the level merely came from is not worth the room; what changed it is.
    expect(reasoningLabel({ reasoning: { level: "medium", cause: "assessment", decider: "redcode" } })).toBe(
      "auto → medium",
    )
    expect(reasoningLabel({ reasoning: { level: "low", cause: "assessment+agrees", decider: "redcode" } })).toBe(
      "auto → low · agrees",
    )
    expect(reasoningLabel({ reasoning: { level: "medium", cause: "jev", decider: "router" } })).toBe("router: medium")
  })

  test("says plain auto before the first turn or over a record it cannot read", () => {
    expect(reasoningLabel(undefined)).toBe("auto")
    expect(reasoningLabel({})).toBe("auto")
    expect(reasoningLabel({ reasoning: "high" })).toBe("auto")
    expect(reasoningLabel({ reasoning: { cause: "frustration" } })).toBe("auto")
  })

  test("labels an assistant message with the level its auto turn applied", () => {
    expect(appliedLabel("auto", "high")).toBe("auto → high")
    expect(appliedLabel("high", "high")).toBeUndefined()
    expect(appliedLabel("auto", undefined)).toBeUndefined()
    expect(appliedLabel("auto", "auto")).toBeUndefined()
    expect(appliedLabel(undefined, "high")).toBeUndefined()
  })

  test("tightens the arrow for the compact footer, leaving arrow-free labels alone", () => {
    expect(compactVariantLabel("auto → xhigh")).toBe("auto→xhigh")
    expect(compactVariantLabel("auto → xhigh · loop guard")).toBe("auto→xhigh · loop guard")
    expect(compactVariantLabel("high")).toBe("high")
    expect(compactVariantLabel("router: medium")).toBe("router: medium")
  })
})
