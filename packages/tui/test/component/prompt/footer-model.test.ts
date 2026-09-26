import { describe, expect, test } from "bun:test"
import { footerS1MaxChars, showFooterRoutes } from "../../../src/component/prompt/footer-model"

describe("prompt footer width behavior", () => {
  test("drops the dim route hint before anything else narrows", () => {
    expect(showFooterRoutes(140)).toBe(true)
    expect(showFooterRoutes(100)).toBe(true)
    expect(showFooterRoutes(99)).toBe(false)
    expect(showFooterRoutes(60)).toBe(false)
  })

  test("truncates the S1 name only after the routes are already gone", () => {
    expect(footerS1MaxChars(140)).toBe(24)
    expect(footerS1MaxChars(70)).toBe(24)
    expect(footerS1MaxChars(69)).toBe(12)
    expect(footerS1MaxChars(40)).toBe(12)
  })
})
