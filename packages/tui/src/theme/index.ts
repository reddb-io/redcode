import { parseThemeDocument, resolveThemeDocument, type ThemeDocument, type ModeDefinition } from "@opencode/theme/tui"
import { DEFAULT_THEMES } from "./builtin"
import redcode from "./assets/builtin/redcode.json" with { type: "json" }
import opencode from "./assets/builtin/opencode.json" with { type: "json" }

export { DEFAULT_THEMES } from "./builtin"
export { generateSyntax, selectedForeground, type Theme } from "./syntax"
export { resolveThemeDocument, type ThemeDocument }

export const DEFAULT_THEME = "redcode"

export type ThemeDocumentSource = Record<string, unknown>

const pluginThemes: Record<string, ThemeDocumentSource> = {}
let customThemes: Record<string, ThemeDocumentSource> = {}
let systemTheme: ThemeDocumentSource | undefined
const listeners = new Set<(themes: Record<string, ThemeDocumentSource>) => void>()
const parsed = new WeakMap<object, ThemeDocument>()
let opencodeTheme:
  | (ThemeDocument & {
      readonly light: ModeDefinition
      readonly dark: ModeDefinition
    })
  | undefined

export function getOpenCodeTheme() {
  if (opencodeTheme) return opencodeTheme
  const document = parseThemeDocument(opencode, "opencode") as NonNullable<typeof opencodeTheme>
  opencodeTheme = document
  return document
}

function listThemes(): Record<string, ThemeDocumentSource> {
  // Priority: defaults < plugin installs < custom files < generated system.
  const themes: Record<string, ThemeDocumentSource> = {
    ...DEFAULT_THEMES,
    opencode: getOpenCodeTheme(),
    redcode,
    ...pluginThemes,
    ...customThemes,
  }
  return {
    ...themes,
    system: systemTheme ?? themes.system ?? themes.opencode,
  }
}

function syncThemes() {
  const themes = listThemes()
  for (const listener of listeners) listener(themes)
}

export function allThemes() {
  return listThemes()
}

export function isThemeSource(source: unknown): source is ThemeDocumentSource {
  if (typeof source !== "object" || source === null || Array.isArray(source)) return false
  return "theme" in source || "base" in source
}

export function parseTheme(source: ThemeDocumentSource, name = "theme") {
  const cached = parsed.get(source)
  if (cached) return cached

  if ("theme" in source)
    throw new Error("This theme requires explicit conversion. Use redcode migrate inspect --kind theme.")
  const document = parseThemeDocument(source, name)

  parsed.set(source, document)
  return document
}

export function subscribeThemes(listener: (themes: Record<string, ThemeDocumentSource>) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setCustomThemes(themes: Record<string, unknown>) {
  customThemes = Object.fromEntries(
    Object.entries(themes).filter((entry): entry is [string, ThemeDocumentSource] => isThemeSource(entry[1])),
  )
  syncThemes()
}

export function setSystemTheme(theme: ThemeDocumentSource | undefined) {
  systemTheme = theme
  syncThemes()
}

export function hasTheme(name: string) {
  if (!name) return false
  return allThemes()[name] !== undefined
}

export function addTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isThemeSource(theme)) return false
  if (hasTheme(name)) return false
  pluginThemes[name] = theme
  syncThemes()
  return true
}

export function upsertTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isThemeSource(theme)) return false
  if (customThemes[name] !== undefined) {
    customThemes[name] = theme
  } else {
    pluginThemes[name] = theme
  }
  syncThemes()
  return true
}
