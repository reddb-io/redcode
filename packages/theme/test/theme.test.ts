import { expect, test } from "bun:test"
import { resolveThemeDocument } from "../src/tui/index.js"
import { migrateV1 } from "../src/tui/import.js"
import type { ThemeV1Json } from "../src/tui/v1.js"

const source: ThemeV1Json = await Bun.file(new URL("fixture/legacy-themes/opencode.json", import.meta.url)).json()
const document = migrateV1(source)

test.each(["light", "dark"] as const)("resolves %s themes without status tokens", (mode) => {
  const theme = resolveThemeDocument(document, mode)
  expect("status" in theme.text).toBeFalse()
  expect(theme.hue.accent[800]).toBeDefined()
  expect(theme.hue.interactive[800]).toBeDefined()
})
