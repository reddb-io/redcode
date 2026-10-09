import { describe, expect, test } from "bun:test"
import { contrastRatio } from "../color"
import { applicationTheme } from "../themes/application"
import type { DesktopTheme, HexColor, ResolvedV2Theme } from "../types"
import { resolveThemeV2, resolveThemeVariantV2, themeV2ToCss } from "./resolve"

// A bundled community theme exercises the engine's own fallbacks, which the built-in theme overrides.
const theme: DesktopTheme = await Bun.file(new URL("../themes/nord.json", import.meta.url)).json()

describe("application theme", () => {
  test.each(["light", "dark"] as const)("%s semantics resolve from design system roles, not literals", (mode) => {
    const tokens = resolveThemeV2(applicationTheme)[mode]
    const semantic = Object.entries(tokens).filter(
      ([name]) => /^v2-(background|text|icon|border|overlay|state|agent)-/.test(name),
    )
    expect(semantic.length).toBeGreaterThan(50)
    for (const [name, value] of semantic) {
      expect([name, /#[0-9a-f]{3,8}\b|rgba?\(/i.test(value)]).toEqual([name, false])
    }
  })

  test("layers read as ink over the surface they sit on", () => {
    const tokens = resolveThemeV2(applicationTheme).dark
    expect(tokens["v2-background-bg-base"]).toBe("var(--reddb-color-elevation-base-surface)")
    expect(tokens["v2-background-bg-layer-01"]).toContain("var(--reddb-color-foreground)")
  })

  test("hover and pressed are the design system's quiet-control fills", () => {
    const tokens = resolveThemeV2(applicationTheme).light
    expect(tokens["v2-overlay-simple-overlay-hover"]).toContain("8%")
    expect(tokens["v2-overlay-simple-overlay-pressed"]).toContain("12%")
  })
})

describe("icon emphasis", () => {
  test.each([false, true])("custom theme fallbacks preserve icon emphasis (dark: %s)", (dark) => {
    expectIconEmphasis(resolveThemeVariantV2({ ...theme[dark ? "dark" : "light"], v2Overrides: undefined }, dark))
  })
})

describe("contrast icon-button tokens", () => {
  test.each([false, true])("custom themes without the new token receive a fallback (dark: %s)", (dark) => {
    const tokens = resolveThemeVariantV2({ ...theme.dark, v2Overrides: undefined }, dark)
    expect(tokens["v2-background-bg-icon-button-contrast"]).toBe(
      dark ? "var(--v2-grey-400)" : "var(--v2-background-bg-contrast)",
    )
    expect(themeV2ToCss(tokens)).toContain(
      `--v2-background-bg-icon-button-contrast: ${tokens["v2-background-bg-icon-button-contrast"]};`,
    )
  })

  test("custom themes can override the icon-button background independently", () => {
    const tokens = resolveThemeVariantV2(
      {
        ...theme.dark,
        v2Overrides: { ...theme.dark.v2Overrides, "v2-background-bg-icon-button-contrast": "#dddddd" },
      },
      true,
    )
    expect(tokens["v2-background-bg-icon-button-contrast"]).toBe("#dddddd")
    expect(tokens["v2-background-bg-contrast"]).toBe("var(--v2-grey-700)")
  })
})

function expectIconEmphasis(tokens: ResolvedV2Theme) {
  const resolve = (value: string): HexColor =>
    value.startsWith("var(--") ? resolve(tokens[value.slice(6, -1)]) : (value as HexColor)
  const background = resolve(tokens["v2-background-bg-base"])
  const contrast = (role: string) => contrastRatio(resolve(tokens[`v2-icon-icon-${role}`]), background)
  expect(contrast("faint")).toBeLessThan(contrast("muted"))
  expect(contrast("muted")).toBeLessThan(contrast("base"))
}
