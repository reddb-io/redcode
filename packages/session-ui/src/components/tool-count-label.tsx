import { createMemo } from "solid-js"
import { AnimatedNumber } from "@reddb-io/redcode-ui/animated-number"

function split(text: string) {
  const match = /{{\s*count\s*}}/.exec(text)
  if (!match) return { before: "", after: text }
  if (match.index === undefined) return { before: "", after: text }
  return {
    before: text.slice(0, match.index),
    after: text.slice(match.index + match[0].length),
  }
}

function common(one: string, other: string) {
  const a = Array.from(one)
  const b = Array.from(other)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return {
    stem: a.slice(0, i).join(""),
    one: a.slice(i).join(""),
    other: b.slice(i).join(""),
  }
}

export type CountLabelKey =
  | "ui.sessionTurn.diffs.changed"
  | "ui.messagePart.context.read"
  | "ui.messagePart.context.search"
  | "ui.messagePart.context.list"

const LABELS: Record<CountLabelKey, { one: string; other: string }> = {
  "ui.sessionTurn.diffs.changed": { one: "{{count}} Changed file", other: "{{count}} Changed files" },
  "ui.messagePart.context.read": { one: "{{count}} read", other: "{{count}} reads" },
  "ui.messagePart.context.search": { one: "{{count}} search", other: "{{count}} searches" },
  "ui.messagePart.context.list": { one: "{{count}} list", other: "{{count}} lists" },
}

export function AnimatedCountLabel(props: { count: number; plural: CountLabelKey; class?: string }) {
  const label = createMemo(() => LABELS[props.plural])
  const category = createMemo(() => (Math.round(props.count) === 1 ? "one" : "other"))
  const one = createMemo(() => split(label().one))
  const other = createMemo(() => split(label().other))
  const active = createMemo(() => split(label()[category()]))
  const suffix = createMemo(() => common(one().after, other().after))
  const splitSuffix = createMemo(
    () =>
      (category() === "one" || category() === "other") &&
      one().before === other().before &&
      (one().after.startsWith(other().after) || other().after.startsWith(one().after)),
  )
  const before = createMemo(() => (splitSuffix() ? one().before : active().before))
  const stem = createMemo(() => (splitSuffix() ? suffix().stem : active().after))
  const tail = createMemo(() => {
    if (!splitSuffix()) return ""
    if (category() === "one") return suffix().one
    return suffix().other
  })
  const showTail = createMemo(() => splitSuffix() && tail().length > 0)

  return (
    <span data-component="tool-count-label" class={props.class}>
      <span data-slot="tool-count-label-before">{before()}</span>
      <AnimatedNumber value={props.count} />
      <span data-slot="tool-count-label-word">
        <span data-slot="tool-count-label-stem">{stem()}</span>
        <span data-slot="tool-count-label-suffix" data-active={showTail() ? "true" : "false"}>
          <span data-slot="tool-count-label-suffix-inner">{tail()}</span>
        </span>
      </span>
    </span>
  )
}