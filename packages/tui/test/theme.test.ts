import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { RGBA, type TerminalColors } from "@opentui/core"
import { DEFAULT_THEME, DEFAULT_THEMES, addTheme, allThemes, hasTheme, resolveTheme, terminalMode } from "../src/theme"
import { discoverThemes } from "../src/context/theme"
import { createColors } from "../src/ui/spinner"
import reddbTokens from "../src/theme/assets/reddb-tokens.json"
import { tmpdir } from "./fixture/fixture"

test("addTheme writes into module theme store", () => {
  const name = `plugin-theme-${Date.now()}`
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)
  expect(allThemes()[name]).toBeDefined()
})

test("addTheme keeps first theme for duplicate names", () => {
  const name = `plugin-theme-keep-${Date.now()}`
  const one = structuredClone(DEFAULT_THEMES.opencode)
  const two = structuredClone(DEFAULT_THEMES.opencode)
  one.theme.primary = "#101010"
  two.theme.primary = "#fefefe"

  expect(addTheme(name, one)).toBe(true)
  expect(addTheme(name, two)).toBe(false)
  expect(allThemes()[name]!.theme.primary).toBe("#101010")
})

test("addTheme ignores entries without a theme object", () => {
  const name = `plugin-theme-invalid-${Date.now()}`
  expect(addTheme(name, { defs: { a: "#ffffff" } })).toBe(false)
  expect(allThemes()[name]).toBeUndefined()
})

test("hasTheme checks theme presence", () => {
  const name = `plugin-theme-has-${Date.now()}`
  expect(hasTheme(name)).toBe(false)
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)
  expect(hasTheme(name)).toBe(true)
})

test("resolveTheme rejects circular color refs", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.defs = { ...item.defs, one: "two", two: "one" }
  item.theme.primary = "one"
  expect(() => resolveTheme(item, "dark")).toThrow("Circular color reference")
})

function terminalColors(defaultBackground: string | null, palette: Array<string | null> = []): TerminalColors {
  return {
    palette,
    defaultForeground: null,
    defaultBackground,
    cursorColor: null,
    mouseForeground: null,
    mouseBackground: null,
    tekForeground: null,
    tekBackground: null,
    highlightBackground: null,
    highlightForeground: null,
  }
}

test("terminalMode derives mode from refreshed background", () => {
  expect(terminalMode(terminalColors("#fbf1c7"))).toBe("light")
  expect(terminalMode(terminalColors("#1a1b26"))).toBe("dark")
})

test("terminalMode does not derive mode from ANSI slot zero", () => {
  expect(terminalMode(terminalColors(null, ["#000000"]))).toBeUndefined()
})

test("custom theme precedence follows directory order", async () => {
  await using tmp = await tmpdir()
  const global = path.join(tmp.path, "global")
  const project = path.join(tmp.path, "project")
  await mkdir(path.join(global, "themes"), { recursive: true })
  await mkdir(path.join(project, "themes"), { recursive: true })
  await writeFile(path.join(global, "themes", "custom.json"), JSON.stringify({ source: "global" }))
  await writeFile(path.join(project, "themes", "custom.json"), JSON.stringify({ source: "project" }))

  await expect(discoverThemes([global, project])).resolves.toEqual({ custom: { source: "project" } })
})

test("redcode focuses Build and its scanner with the RedDB palette", () => {
  expect(DEFAULT_THEME).toBe("redcode")
  expect(reddbTokens.provenance).toEqual({
    repository: "https://github.com/reddb-io/brand",
    revision: "8f9c1da8d807c206dac86d618f7c50eabe7b2298",
    source: "tokens/tokens.json",
  })
  const source = DEFAULT_THEMES.redcode
  expect(source).toBeDefined()
  if (!source) throw new Error("redcode theme is missing")

  for (const mode of ["dark", "light"] as const) {
    const theme = resolveTheme(source, mode)
    const build = theme.secondary
    const scanner = createColors({ color: build, headColor: theme.accent, enableFading: false })

    expect(theme.primary.toInts()).toEqual([255, 32, 86, 255])
    expect(build.toInts()).toEqual([255, 32, 86, 255])
    expect(theme.borderActive.toInts()).toEqual([209, 26, 70, 255])
    const scannerHead = scanner(0, 0, 1, 8)
    expect(scannerHead).toBeInstanceOf(RGBA)
    if (!(scannerHead instanceof RGBA)) throw new Error("scanner head did not resolve to RGBA")
    expect(scannerHead.toInts()).toEqual([255, 99, 137, 255])
    const semantic = [theme.success, theme.warning, theme.error].map((color) => color.toInts().join(","))
    expect(new Set(semantic).size).toBe(3)
    expect(semantic).not.toContain(theme.primary.toInts().join(","))
    expect(contrast(theme.text, theme.background)).toBeGreaterThan(7)
  }

  expect(resolveTheme(source, "dark").text.toInts()).toEqual([244, 245, 247, 255])
  expect(resolveTheme(source, "light").text.toInts()).toEqual([7, 8, 10, 255])
  expect(resolveTheme(DEFAULT_THEMES.opencode!, "light").primary.toInts()).toEqual([59, 125, 216, 255])
})

function contrast(foreground: RGBA, background: RGBA) {
  const luminance = (color: RGBA) => {
    const channel = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}
