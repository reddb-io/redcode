import type { TuiStatuslineImportance, TuiStatuslineSegment } from "@opencode-ai/plugin/tui"
import { Locale } from "./util/locale"

const importance = (value: TuiStatuslineImportance | undefined) => {
  if (value === "required") return 2
  if (value === "normal") return 1
  return 0
}

const width = (segments: ReadonlyArray<TuiStatuslineSegment>) =>
  segments.reduce((total, item) => total + Bun.stringWidth(item.text), 0) + Math.max(0, segments.length - 1) * 3

export function fitStatuslineSegments(input: ReadonlyArray<TuiStatuslineSegment>, maxWidth: number) {
  const ordered = input.toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const shortened = ordered.map((item) => ({ ...item, text: item.short ?? item.text }))
  const initial = width(ordered) <= maxWidth ? ordered : shortened
  const fitted = ["optional", "normal"].reduce((items, level) => {
    if (width(items) <= maxWidth) return items
    return items
      .toReversed()
      .reduce((state, item) => {
        if (width(state) <= maxWidth) return state
        if ((item.importance ?? "optional") !== level) return state
        const index = state.findIndex((candidate) => candidate.id === item.id)
        return state.toSpliced(index, 1)
      }, items)
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }, initial)
  if (width(fitted) <= maxWidth) return fitted
  if (!fitted.length) return fitted
  const available = Math.max(1, maxWidth - width(fitted.slice(0, -1)) - (fitted.length > 1 ? 3 : 0))
  return fitted.map((item, index) =>
    index === fitted.length - 1 ? { ...item, text: Locale.truncate(item.text, available) } : item,
  )
}

export function mergeStatuslineSegments(
  base: ReadonlyArray<TuiStatuslineSegment>,
  contributions: ReadonlyArray<ReadonlyArray<TuiStatuslineSegment>>,
) {
  return Array.from(
    [...base, ...contributions.flat()]
      .reduce((items, item) => items.set(item.id, item), new Map<string, TuiStatuslineSegment>())
      .values(),
  ).toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0) || importance(b.importance) - importance(a.importance))
}
