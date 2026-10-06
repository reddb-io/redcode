export * as DesignVerify from "./verify.js"

import type { Design } from "@opencode/schema/design"
import type { Viewport } from "./ui/viewports.js"

/**
 * The pure parts of a round's verify: where each note is rendered and what changed in its element.
 * The renderer gathers the facts in the browser; deciding from them stays here, testable without one.
 */

/** How many distinct viewports one verify renders; a note taken at another is verified at the nearest kept one. */
export const WIDTHS = 3

/** Recorded widths outside this range are clamped: narrower is not a real screen, wider costs more than it shows. */
const RANGE = { minimum: 240, maximum: 3840 } as const

/**
 * Recorded widths this fraction apart share one viewport: a note taken at 1187px and one at 1210px
 * render alike, while 768px and 800px may straddle a breakpoint and stay apart.
 */
const TOLERANCE = 0.025

/** Up to this percent of an element's pixels may differ between identical renders (anti-aliasing), not an edit. */
export const PIXELS = 0.1

/** Box changes up to this many CSS pixels are rounding, not a move or a resize. */
const SLACK = 2

/** The clipped length, in UTF-16 units as the schema counts, of the element text a delta quotes on each side. */
const QUOTE = 240

export interface Placement {
  readonly viewport: Viewport
  /** Positions of the notes rendered at this viewport, in the round's order. */
  readonly notes: ReadonlyArray<number>
}

export interface Collapsed {
  readonly from: Viewport
  readonly to: Viewport
  readonly notes: number
}

/**
 * Group a round's notes by the viewport each was taken at: the phone an app note names, the width a
 * web or slide note recorded (clamped to a real screen, and sharing a slot with near widths, see
 * `slots`), or the widest configured viewport when the note recorded neither, as every note was
 * verified before widths were recorded. At most `cap`
 * viewports are kept, those with the most notes (wider first on a tie); the notes of any other are
 * verified at the nearest kept one, and `collapsed` says which, so the job can report it.
 */
export function placements(
  notes: ReadonlyArray<Pick<Design.Note, "item">>,
  sizes: ReadonlyArray<Viewport>,
  cap = WIDTHS,
) {
  const widest = sizes.reduce((best, item) => (item.width > best.width ? item : best))
  const phones = sizes.some((size) => size.device)
  const clamped = notes.map((note) =>
    note.item.width ? Math.min(RANGE.maximum, Math.max(RANGE.minimum, note.item.width)) : undefined,
  )
  const slot = slots(
    clamped.filter((width) => width !== undefined),
    sizes,
  )
  const wanted = notes.map((note, position): Viewport => {
    const width = clamped[position]
    if (phones)
      return (
        sizes.find((size) => size.device && size.device === note.item.platform) ??
        (width ? nearest(sizes, width) : widest)
      )
    return width ? slot(width) : widest
  })
  const groups = [...Map.groupBy(wanted.entries(), ([, viewport]) => key(viewport)).values()].map((entries) => ({
    viewport: entries[0][1],
    notes: entries.map(([position]) => position),
  }))
  const ranked = groups.toSorted((a, b) => b.notes.length - a.notes.length || b.viewport.width - a.viewport.width)
  const kept = ranked.slice(0, Math.max(1, cap))
  // A collapsed note stays on its own phone when that phone is kept.
  const moved = ranked.slice(kept.length).map((group) => {
    const same = kept.filter((item) => item.viewport.device === group.viewport.device)
    return { group, to: nearest((same.length ? same : kept).map((item) => item.viewport), group.viewport.width) }
  })
  const placed: Placement[] = kept
    .map((group) => ({
      viewport: group.viewport,
      notes: [
        ...group.notes,
        ...moved.flatMap((item) => (key(item.to) === key(group.viewport) ? item.group.notes : [])),
      ].toSorted((a, b) => a - b),
    }))
    .toSorted((a, b) => a.viewport.width - b.viewport.width)
  const collapsed: Collapsed[] = moved.map((item) => ({
    from: item.group.viewport,
    to: item.to,
    notes: item.group.notes.length,
  }))
  return { placements: placed, collapsed }
}

const key = (viewport: Viewport) => `${viewport.device ?? ""} ${viewport.width}`

function nearest(sizes: ReadonlyArray<Viewport>, width: number) {
  return sizes.reduce((best, item) => (Math.abs(item.width - width) < Math.abs(best.width - width) ? item : best))
}

/**
 * The viewport each recorded width is verified at. A width within TOLERANCE of a configured viewport
 * takes that viewport; the other widths, narrowest first, form slots of widths within TOLERANCE of
 * the slot's narrowest, each verified at the width most of its notes recorded (the widest on a tie).
 */
function slots(widths: ReadonlyArray<number>, sizes: ReadonlyArray<Viewport>) {
  const configured = (width: number) => {
    const size = nearest(sizes, width)
    return Math.abs(size.width - width) <= size.width * TOLERANCE ? size : undefined
  }
  const loose = widths.filter((width) => !configured(width))
  const count = (width: number) => loose.filter((item) => item === width).length
  const groups = [...new Set(loose)]
    .toSorted((a, b) => a - b)
    .reduce<number[][]>((all, width) => {
      const last = all.at(-1)
      return last && width <= last[0] * (1 + TOLERANCE) ? [...all.slice(0, -1), [...last, width]] : [...all, [width]]
    }, [])
  const chosen = new Map(
    groups.flatMap((group) => {
      const width = group.toSorted((a, b) => count(b) - count(a) || b - a)[0]
      return group.map((item) => [item, width] as const)
    }),
  )
  return (width: number): Viewport => {
    const size = configured(width)
    if (size) return size
    const kept = chosen.get(width) ?? width
    return { width: kept, height: nearest(sizes, kept).height }
  }
}

/**
 * Where a note was verified, when that is not where it was taken: a width that shares a slot with a
 * near one, a width clamped to a real screen, or a viewport collapsed into a kept one past the cap.
 * Empty when they match or the note recorded no viewport.
 */
export function displaced(item: Pick<Design.FeedbackItem, "width" | "platform">, viewport: Viewport) {
  const width = item.width !== undefined && item.width !== viewport.width
  const platform = item.platform !== undefined && viewport.device !== undefined && item.platform !== viewport.device
  if (!width && !platform) return ""
  const taken = viewportLabel({
    width: item.width ?? viewport.width,
    device: item.platform && viewport.device ? item.platform : undefined,
  })
  return `verified at ${viewportLabel(viewport)}, not at ${taken} where the note was taken`
}

/** A viewport as a note line or a report names it, such as `390px` or `393px iOS`. */
export function viewportLabel(viewport: Pick<Viewport, "width" | "device">) {
  return `${viewport.width}px${viewport.device ? ` ${viewport.device === "ios" ? "iOS" : "Android"}` : ""}`
}

/** One line for each viewport whose notes were verified at another, for the job's findings. */
export function collapsedFindings(collapsed: ReadonlyArray<Collapsed>, cap = WIDTHS) {
  return collapsed.map(
    (item) =>
      `review · ${item.notes} note${item.notes === 1 ? "" : "s"} taken at ${viewportLabel(item.from)} verified at ${viewportLabel(item.to)}: one verify renders at most ${cap} viewports`,
  )
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** What the browser read of a located element: its box in page coordinates, its text and its markup fingerprint. */
export interface Facts {
  readonly rect: Rect
  readonly text: string
  readonly markup: string
}

/**
 * What changed in a note's element: `before` is the element on the revision the note was taken on
 * (undefined when that revision rendered without it), `after` on the verified one, `pixels` the
 * percent of differing pixels between same-size captures when it could be measured. Pass the same
 * facts twice when both sides are one revision: nothing changed.
 *
 * An element missing on the note's own revision is not a new element: the reviewer took the note on
 * it there, so the locator missed it (a weak selector, another state). That measures nothing, so the
 * delta is `known: false` and claims neither a change nor its absence.
 */
export function delta(before: Facts | undefined, after: Facts, pixels?: number): Design.VerifyDelta {
  if (!before) return { changed: false, known: false, text: false, markup: false, moved: false, resized: false }
  const differs = (a: number, b: number) => Math.abs(a - b) > SLACK
  const text = before.text !== after.text
  const markup = before.markup !== after.markup
  const moved = differs(before.rect.x, after.rect.x) || differs(before.rect.y, after.rect.y)
  const resized = differs(before.rect.width, after.rect.width) || differs(before.rect.height, after.rect.height)
  return {
    changed: text || markup || moved || resized || (pixels ?? 0) > PIXELS,
    ...(pixels === undefined ? {} : { pixels: Math.round(pixels * 100) / 100 }),
    text,
    markup,
    moved,
    resized,
    ...(text ? { textBefore: clip(before.text), textAfter: clip(after.text) } : {}),
  }
}

/** Clipped to the schema's bound in UTF-16 units, never splitting a surrogate pair. */
const clip = (text: string) => {
  if (text.length <= QUOTE) return text
  const head = text.slice(0, QUOTE - 1)
  return `${/[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head}…`
}

/** A delta that measured nothing, including the `added` that earlier verifies wrote for the same case. */
export const unmeasured = (change: Design.VerifyDelta) => change.known === false || change.added === true

/** A page-level note names no element: it resolves to the whole variant root or the document body. */
export const isPage = (target: string) => target.replace(/^variant:[a-zA-Z0-9_-]{1,64} /, "").trim() === "page"

/** The delta in a few words, for the note's verify reason and the agent. */
export function describe(change: Design.VerifyDelta) {
  if (unmeasured(change))
    return "change: could not be measured (the element was not located on the revision the note was taken on), so this is no evidence of a change"
  if (!change.changed) return "change: none to the element (pixels, text, markup, style, position and size are the same)"
  const parts = [
    change.pixels !== undefined && change.pixels > PIXELS ? `${change.pixels}% of pixels` : "",
    change.text ? "text" : "",
    change.markup ? "markup or style" : "",
    change.moved ? "moved" : "",
    change.resized ? "resized" : "",
  ].filter(Boolean)
  return `change: ${parts.join(", ")}`
}

/**
 * What a note's verify reason says after found or missing and the findings: the change in its element
 * (or why a page-level note has none), the scenarios that verified a behavior, and where it was
 * verified when that is not where it was taken.
 */
export function remarks(input: {
  readonly item: Pick<Design.FeedbackItem, "target" | "width" | "platform">
  readonly viewport: Viewport
  readonly found: boolean
  readonly delta?: Design.VerifyDelta
  readonly exercised?: ReadonlyArray<string>
}) {
  const measured = input.found && isPage(input.item.target)
    ? "change: not measured for a page-level note (the whole page is not compared as one element)"
    : input.found && input.delta
      ? describe(input.delta)
      : ""
  const behavior =
    input.found && input.exercised?.length
      ? `behavior verified by scenario${input.exercised.length === 1 ? "" : "s"} ${input.exercised.join(", ")}`
      : ""
  return [measured, behavior, displaced(input.item, input.viewport)].filter(Boolean)
}
