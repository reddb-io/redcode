import { describe, expect, test } from "bun:test"
import {
  clampSidebarWidth,
  effectiveSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  sidebarWidthDefault,
  sidebarWidthMax,
} from "../../src/routes/session/sidebar-width"

describe("sidebarWidthMax", () => {
  test("preserves room for the session in a side-by-side layout", () => {
    expect(sidebarWidthMax({ available: 140, overlay: false })).toBe(SIDEBAR_WIDTH_MAX)
    expect(sidebarWidthMax({ available: 124, overlay: false })).toBe(64)
  })

  test("allows more room when the sidebar overlays the session", () => {
    expect(sidebarWidthMax({ available: 100, overlay: true })).toBe(SIDEBAR_WIDTH_MAX)
    expect(clampSidebarWidth({ width: SIDEBAR_WIDTH_MIN, available: 20, overlay: true })).toBe(12)
  })
})

describe("clampSidebarWidth", () => {
  test("clamps persisted and dragged widths", () => {
    expect(clampSidebarWidth({ width: 10, available: 140, overlay: false })).toBe(SIDEBAR_WIDTH_MIN)
    expect(clampSidebarWidth({ width: 90, available: 140, overlay: false })).toBe(SIDEBAR_WIDTH_MAX)
    expect(clampSidebarWidth({ width: 70, available: 124, overlay: false })).toBe(64)
  })
})

describe("sidebarWidthDefault", () => {
  test("stays at the base default below the wide breakpoint", () => {
    expect(sidebarWidthDefault(120)).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  test("grows a modest step on wide terminals", () => {
    expect(sidebarWidthDefault(170)).toBe(40)
  })

  test("grows a bit more on ultrawide terminals, never proportionally", () => {
    expect(sidebarWidthDefault(240)).toBe(44)
  })
})

describe("effectiveSidebarWidth", () => {
  test("follows the width-aware default when the user never resized", () => {
    expect(effectiveSidebarWidth(undefined, 120)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(effectiveSidebarWidth(undefined, 170)).toBe(40)
    expect(effectiveSidebarWidth(undefined, 240)).toBe(44)
  })

  test("treats a stored legacy default (36) the same as unset", () => {
    expect(effectiveSidebarWidth(SIDEBAR_WIDTH_DEFAULT, 240)).toBe(44)
  })

  test("preserves an explicit user choice across terminal widths", () => {
    expect(effectiveSidebarWidth(52, 120)).toBe(52)
    expect(effectiveSidebarWidth(52, 170)).toBe(52)
    expect(effectiveSidebarWidth(52, 240)).toBe(52)
  })

  test("still clamps a resolved default so the main column keeps its minimum", () => {
    expect(clampSidebarWidth({ width: effectiveSidebarWidth(undefined, 240), available: 100, overlay: false })).toBe(
      sidebarWidthMax({ available: 100, overlay: false }),
    )
  })
})
