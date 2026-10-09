import { nativeTheme } from "electron"
import { BACKGROUND_COLOR_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

// Frame defaults shared by the early window (created on ready, before the renderer exists) and the
// full window setup in appearance.ts, so both draw the same frame.

// The built-in Redcode theme resolves its colors from design-system CSS roles, which the main process cannot
// evaluate, so the frame uses the theme's neutral seeds (packages/ui/src/theme/themes/application.ts).
const defaultBackground = { light: "#f4f5f7", dark: "#12141b" }

// Match the renderer's 36px titlebar plus its former 8px content inset.
export const titlebarHeight = 44

export function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

// The colour the renderer reported on its last run, or the default theme's for the system tone, so
// a window shown before the renderer paints already has the right background.
export function storedBackgroundColor() {
  const stored = getStore().get(BACKGROUND_COLOR_KEY)

  if (typeof stored === "string") return stored

  return defaultBackground[tone()]
}

export function titlebarOverlay(mode: "light" | "dark" = tone(), zoom = 1) {
  return {
    color: "#00000000",
    symbolColor: mode === "dark" ? "white" : "black",
    height: Math.max(titlebarHeight, Math.round(titlebarHeight * zoom)),
  }
}