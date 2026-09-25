export const SIDEBAR_WIDTH_DEFAULT = 36
export const SIDEBAR_WIDTH_MIN = 30
export const SIDEBAR_WIDTH_MAX = 72
export const SIDEBAR_WIDTH_STEP = 4

// Wide terminals (4K and up) have spare columns in the main column, so the sidebar's default
// grows a modest, fixed step rather than proportionally with the terminal.
const SIDEBAR_WIDTH_WIDE_BREAKPOINT = 160
const SIDEBAR_WIDTH_WIDE_DEFAULT = 40
const SIDEBAR_WIDTH_ULTRAWIDE_BREAKPOINT = 220
const SIDEBAR_WIDTH_ULTRAWIDE_DEFAULT = 44

export function sidebarWidthDefault(columns: number) {
  if (columns >= SIDEBAR_WIDTH_ULTRAWIDE_BREAKPOINT) return SIDEBAR_WIDTH_ULTRAWIDE_DEFAULT
  if (columns >= SIDEBAR_WIDTH_WIDE_BREAKPOINT) return SIDEBAR_WIDTH_WIDE_DEFAULT
  return SIDEBAR_WIDTH_DEFAULT
}

// `stored` is undefined when the user has never resized the sidebar, or equals the legacy
// default (36) from before width-aware defaults existed. Either case still follows the
// width-aware default rather than a value the user chose.
export function effectiveSidebarWidth(stored: number | undefined, columns: number) {
  if (stored === undefined || stored === SIDEBAR_WIDTH_DEFAULT) return sidebarWidthDefault(columns)
  return stored
}

export function sidebarWidthMax(input: { available: number; overlay: boolean }) {
  const remaining = input.overlay ? 8 : 60
  return Math.max(1, Math.min(SIDEBAR_WIDTH_MAX, input.available - remaining))
}

export function clampSidebarWidth(input: { width: number; available: number; overlay: boolean }) {
  const max = sidebarWidthMax(input)
  return Math.max(Math.min(SIDEBAR_WIDTH_MIN, max), Math.min(input.width, max))
}
