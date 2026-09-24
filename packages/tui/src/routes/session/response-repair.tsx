import { createSignal, Show, type JSX } from "solid-js"
import type { Part } from "@reddb-io/redcode-sdk/v2"
import { useTheme } from "../../context/theme"

/** The issues a response repair names, when the metadata carries one. */
export function responseRepairIssues(metadata: Record<string, unknown> | undefined) {
  const repair = metadata?.responseRepair
  if (typeof repair !== "object" || repair === null || !("issues" in repair) || !Array.isArray(repair.issues))
    return undefined
  return repair.issues.filter((issue): issue is string => typeof issue === "string")
}

/**
 * How S1 response repairs fold a turn's attempts into one reply. The answer a repair revised is
 * `superseded`: its text and thought give way to the revision, while its tool calls stay in place
 * because they really ran. The last assistant message after the repairs carries the revision `note`,
 * which names the issues and keeps the superseded answers for the user to open. A repair nothing has
 * answered yet is `pending`, and its answer stays visible until the revision starts.
 */
export function responseRevisions(
  messages: ReadonlyArray<{ id: string; role: string }>,
  parts: Record<string, ReadonlyArray<Part> | undefined>,
) {
  const repairs = new Map(
    messages.flatMap((message) => {
      if (message.role !== "user") return []
      const issues = (parts[message.id] ?? [])
        .map((part) => (part.type === "text" && part.synthetic ? responseRepairIssues(part.metadata) : undefined))
        .find((issues) => issues !== undefined)
      return issues ? [[message.id, issues] as const] : []
    }),
  )
  const superseded = new Set<string>()
  const pending = new Set<string>()
  const notes = new Map<string, { issues: string[]; originals: string[] }>()
  messages.forEach((message, index) => {
    const issues = repairs.get(message.id)
    const original = messages[index - 1]
    if (!issues || original?.role !== "assistant") return
    // The reply runs until the next prompt the user wrote; a later repair extends it.
    const end = messages.findIndex((next, at) => at > index && next.role === "user" && !repairs.has(next.id))
    const revision = messages
      .slice(index + 1, end === -1 ? undefined : end)
      .findLast((next) => next.role === "assistant")
    if (!revision) return void pending.add(message.id)
    superseded.add(original.id)
    const note = notes.get(revision.id)
    notes.set(revision.id, {
      issues: [...new Set([...(note?.issues ?? []), ...issues])],
      originals: [...(note?.originals ?? []), original.id],
    })
  })
  return { superseded, pending, notes }
}

/**
 * The muted footnote under a revised answer. The superseded answer (`children`) renders only once
 * the user opens it, so the reply reads as the final answer alone.
 */
export function ResponseRevisionNote(props: { issues: ReadonlyArray<string>; children: JSX.Element }) {
  const { theme } = useTheme()
  const [open, setOpen] = createSignal(false)
  return (
    <>
      <box paddingLeft={3} marginTop={1} flexShrink={0}>
        <text fg={theme.textMuted} onMouseUp={() => setOpen((value) => !value)}>
          ↻ revised after S1 review{props.issues.length ? ` (${props.issues.join(", ")})` : ""} ·{" "}
          {open() ? "hide original" : "show original"}
        </text>
      </box>
      <Show when={open()}>{props.children}</Show>
    </>
  )
}
