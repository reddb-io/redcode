import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigDesign } from "../src/config/design.js"

describe("ConfigDesign", () => {
  test("decodes the layout-audit gate and viewport classes", () => {
    const decoded = Schema.decodeUnknownSync(ConfigDesign.Info)({ gate: true, viewports: ["mobile", "desktop"] })
    expect(decoded.gate).toBe(true)
    expect(decoded.viewports).toEqual(["mobile", "desktop"])
  })

  test("the most specific document that sets gate or viewports wins", () => {
    expect(ConfigDesign.merge([{ gate: true, viewports: ["mobile"] }, { gate: false }])).toEqual({
      gate: false,
      viewports: ["mobile"],
    })
  })

  test("leaves the gate off when no document sets it", () => {
    expect(ConfigDesign.merge([{ browser: "default" }])?.gate).toBeUndefined()
    expect(ConfigDesign.merge([undefined])).toBeUndefined()
  })
})
