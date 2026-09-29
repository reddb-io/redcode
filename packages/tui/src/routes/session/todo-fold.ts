export * as TodoFold from "./todo-fold"

import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"

export const TOOL = "todowrite"

/**
 * A run of consecutive failed todowrite calls: its first call, its size, its latest call and every
 * call in order. `corrected` says a successful todowrite followed the run directly.
 */
export type Run = {
  lead: string
  count: number
  latest: SessionMessageAssistantTool
  parts: readonly SessionMessageAssistantTool[]
  corrected: boolean
}

const CORRECTED = Symbol("corrected")
/** A message reduced to its failed todowrite calls, `null` wherever a run breaks, `CORRECTED` where a todowrite succeeded. */
type Segment = readonly (SessionMessageAssistantTool | null | typeof CORRECTED)[]

/**
 * Consecutive failed todowrite calls fold into one row, across assistant messages.
 *
 * A model that trips the evidence gate retries several times in a row, and every retry is a new
 * step and so a new assistant message; each refusal would otherwise be its own error row. Runs are
 * keyed by tool call ID: the lead renders one counted row, the rest render nothing. Reasoning,
 * empty text and idle markers do not break a run; anything else that renders, another message or an
 * assistant error does. A successful todowrite breaks it and marks it corrected.
 */
export function fold(messages: readonly SessionMessageInfo[]) {
  return runs(messages.map(segment))
}

/**
 * {@link fold} with each finished assistant message reduced once. The fold reruns on every streamed
 * token, so a finished message's segment is reused while its part count, error, last part and the
 * positions and statuses of its todowrite calls are unchanged; only the live message is walked.
 */
export function createFold() {
  type Entry = {
    length: number
    error: boolean
    last?: string
    todos: readonly (readonly [index: number, id: string, status: string])[]
    segment: Segment
  }
  const cache = new Map<string, Entry>()
  return (messages: readonly SessionMessageInfo[]) =>
    runs(
      messages.map((message) => {
        if (message.type !== "assistant" || message.time.completed === undefined) return segment(message)
        const cached = cache.get(message.id)
        const content = message.content
        if (
          cached &&
          cached.length === content.length &&
          cached.error === (message.error !== undefined) &&
          cached.last === lastKey(content.at(-1)) &&
          cached.todos.every(([index, id, status]) => {
            const part = content[index]
            return part?.type === "tool" && part.id === id && part.state.status === status
          })
        )
          return cached.segment
        const next = segment(message)
        cache.set(message.id, {
          length: content.length,
          error: message.error !== undefined,
          last: lastKey(content.at(-1)),
          todos: content.flatMap((part, index) =>
            part.type === "tool" && part.name === TOOL ? [[index, part.id, part.state.status] as const] : [],
          ),
          segment: next,
        })
        return next
      }),
    )
}

/** Whether a run renders at all: a single failure the model fixed on its next call does not. */
export function shown(run: Run | undefined) {
  return !run || run.count > 1 || !run.corrected
}

/** The row label: the count, then the first line of the latest refusal. */
export function label(run: Run | undefined, part: SessionMessageAssistantTool, limit = 160) {
  const count = run?.count ?? 1
  const head = count > 1 ? `Todo update failed ×${count}` : "Todo update failed"
  const line =
    errorText(run?.latest ?? part)
      .trim()
      .split("\n")[0] ?? ""
  if (!line) return head
  return `${head}: ${line.length > limit ? `${line.slice(0, limit - 1)}…` : line}`
}

/** Every refusal of a run, numbered, as the expanded row shows them. */
export function errors(parts: readonly SessionMessageAssistantTool[]) {
  const texts = parts.map(errorText)
  return texts.length > 1 ? texts.map((text, index) => `${index + 1}. ${text}`).join("\n\n") : (texts[0] ?? "")
}

function errorText(part: SessionMessageAssistantTool) {
  return part.state.status === "error" ? part.state.error.message : ""
}

function lastKey(part: SessionMessageAssistant["content"][number] | undefined) {
  if (!part) return undefined
  return part.type === "tool" ? `${part.id}:${part.state.status}` : `${part.type}:${part.text.trim() === ""}`
}

function segment(message: SessionMessageInfo): Segment {
  if (message.type === "idle") return []
  if (message.type !== "assistant") return [null]
  const items: (SessionMessageAssistantTool | null | typeof CORRECTED)[] = []
  const open = () => {
    const last = items.at(-1)
    return last !== undefined && last !== null && last !== CORRECTED
  }
  message.content.forEach((part) => {
    if (part.type === "tool" && part.name === TOOL && part.state.status === "error") {
      items.push(part)
      return
    }
    if (part.type === "tool" && part.name === TOOL && part.state.status === "completed") {
      if (open()) items.push(CORRECTED)
      return
    }
    if (part.type === "reasoning") return
    if (part.type === "text" && !part.text.trim()) return
    if (open()) items.push(null)
  })
  if (message.error !== undefined && open()) items.push(null)
  return items
}

function runs(segments: readonly Segment[]) {
  const result = new Map<string, Run>()
  const current: SessionMessageAssistantTool[] = []
  const close = (corrected: boolean) => {
    const parts = current.splice(0)
    const latest = parts.at(-1)
    if (!latest) return
    const run = { lead: parts[0].id, count: parts.length, latest, parts, corrected }
    parts.forEach((part) => result.set(part.id, run))
  }
  segments.forEach((items) =>
    items.forEach((item) => {
      if (item === null || item === CORRECTED) return close(item === CORRECTED)
      current.push(item)
    }),
  )
  close(false)
  return result
}
