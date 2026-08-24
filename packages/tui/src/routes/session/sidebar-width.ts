export const SIDEBAR_WIDTH_DEFAULT = 36
export const SIDEBAR_WIDTH_MIN = 30
export const SIDEBAR_WIDTH_MAX = 72
export const SIDEBAR_WIDTH_STEP = 4

export function sidebarWidthMax(input: { available: number; overlay: boolean }) {
  const remaining = input.overlay ? 8 : 60
  return Math.max(1, Math.min(SIDEBAR_WIDTH_MAX, input.available - remaining))
}

export function clampSidebarWidth(input: { width: number; available: number; overlay: boolean }) {
  const max = sidebarWidthMax(input)
  return Math.max(Math.min(SIDEBAR_WIDTH_MIN, max), Math.min(input.width, max))
}
