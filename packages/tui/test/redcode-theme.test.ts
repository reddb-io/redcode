import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { allThemes, DEFAULT_THEME, parseTheme, resolveThemeDocument } from "../src/theme"

test.each(["dark", "light"] as const)("Redcode preserves brand and agent identity in %s mode", (mode) => {
  expect(DEFAULT_THEME).toBe("redcode")
  const theme = resolveThemeDocument(parseTheme(allThemes()[DEFAULT_THEME]), mode)
  const expected = [
    "#ff2056",
    mode === "dark" ? "#e3b341" : "#b8860b",
    mode === "dark" ? "#2ab3c8" : "#0e8ea3",
    mode === "dark" ? "#7fd88f" : "#3d9a57",
  ]
  expected.forEach((color, index) => expect(theme.categorical[index][200].equals(RGBA.fromHex(color))).toBe(true))
  expect(theme.text.action.primary.selected.equals(RGBA.fromHex("#ff2056"))).toBe(true)
  expect(theme.text.base.equals(RGBA.fromHex(mode === "dark" ? "#f4f5f7" : "#07080a"))).toBe(true)
  expect(theme.markdown.link.equals(RGBA.fromHex(mode === "dark" ? "#ff6389" : "#ad163a"))).toBe(true)
  expect(theme.scrollbar.base.equals(RGBA.fromHex("#d11a46"))).toBe(true)
  expect(theme.text.feedback.info.base.equals(RGBA.fromHex(mode === "dark" ? "#2ab3c8" : "#0e8ea3"))).toBe(true)
})

test("a custom theme still controls categorical colors", () => {
  const source = structuredClone(allThemes().redcode)
  const document = parseTheme(source)
  if (!document.dark) throw new Error("Redcode must provide dark mode")
  const theme = resolveThemeDocument({ ...document, dark: { ...document.dark, categorical: ["green"] } }, "dark")
  expect(theme.categorical).toHaveLength(1)
  expect(theme.categorical[0][200].equals(RGBA.fromHex("#7fd88f"))).toBe(true)
})
