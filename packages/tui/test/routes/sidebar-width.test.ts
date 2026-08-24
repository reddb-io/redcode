import { describe, expect, test } from "bun:test"
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
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
