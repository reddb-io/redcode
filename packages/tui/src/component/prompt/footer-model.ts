/**
 * How the prompt footer's compact model line (`<model>·<variant> ⁄ <s1>`, with the routes dim and
 * right-aligned when there is room) gives up width. The dim routes go first, then the S1 name
 * truncates further; the S2 model name is never shortened for width, so it stays the last thing
 * standing as the terminal narrows.
 */

/** The terminal width below which the dim, right-aligned route hint is dropped entirely. */
const ROUTES_MIN_WIDTH = 100

/** Below this width the S1 name truncates to its narrow length instead of its wide one. */
const S1_NARROW_WIDTH = 70
const S1_NAME_WIDE = 24
const S1_NAME_NARROW = 12

export function showFooterRoutes(width: number) {
  return width >= ROUTES_MIN_WIDTH
}

export function footerS1MaxChars(width: number) {
  return width < S1_NARROW_WIDTH ? S1_NAME_NARROW : S1_NAME_WIDE
}
