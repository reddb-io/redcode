import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { canonicalToolName } from "./tool-display"

/**
 * What a running Session is doing, read from its projected messages: the busy phase, the step the
 * run is on, and whether anything has arrived lately. A spinner alone looks the same for a model
 * that is thinking and a request that is stuck; this says which.
 */

/** Long enough for a slow model to think, short enough that a stuck request is not taken for work. */
export const QUIET_NOTICE_MS = 90_000

export type Activity =
  | { readonly phase: "waiting" | "thinking" | "writing"; readonly step: number }
  | { readonly phase: "tool"; readonly tool: string; readonly preparing: boolean; readonly step: number }
  | { readonly phase: "retrying"; readonly attempt: number; readonly step: number }
  | { readonly phase: "compacting" }

/** The phase and step of a running Session. A step is one model call; the count restarts with each prompt. */
export function activity(messages: readonly SessionMessageInfo[]): Activity {
  const last = messages.at(-1)
  if (last?.type === "compaction" && last.status === "running") return { phase: "compacting" }
  const steps = messages
    .slice(messages.findLastIndex((item) => item.type === "user") + 1)
    .filter((item): item is SessionMessageAssistant => item.type === "assistant")
  const current = steps.at(-1)
  // Between steps, and before the first, the next request is on its way.
  if (!current || current.time.completed !== undefined) return { phase: "waiting", step: steps.length + 1 }
  const step = steps.length
  if (current.retry) return { phase: "retrying", attempt: current.retry.attempt, step }
  // A tool still running is the most informative thing, even while more output streams.
  const tool = current.content.findLast(
    (part) => part.type === "tool" && (part.state.status === "running" || part.state.status === "streaming"),
  )
  if (tool?.type === "tool")
    return { phase: "tool", tool: canonicalToolName(tool.name), preparing: tool.state.status === "streaming", step }
  const part = current.content.at(-1)
  if (part?.type === "reasoning") return { phase: "thinking", step }
  if (part?.type === "text") return { phase: "writing", step }
  return { phase: "waiting", step }
}

export function describe(activity: Activity) {
  if (activity.phase === "compacting") return "Compacting the conversation"
  const label =
    activity.phase === "tool"
      ? `${activity.preparing ? "Preparing" : "Running"} ${activity.tool}`
      : activity.phase === "retrying"
        ? `Retrying (attempt ${activity.attempt})`
        : activity.phase === "thinking"
          ? "Thinking"
          : activity.phase === "writing"
            ? "Responding"
            : "Waiting for the model"
  return activity.step > 1 ? `${label} · step ${activity.step}` : label
}

/**
 * A cheap fingerprint of how far the run has got: a new message or part, more text or tool input,
 * or a tool changing state moves it. The caller times how long it stays the same.
 */
export function progress(messages: readonly SessionMessageInfo[]) {
  const last = messages.at(-1)
  if (!last) return ""
  if (last.type === "compaction")
    return `${last.id}|${last.status}|${last.status === "running" ? last.summary.length : 0}`
  if (last.type !== "assistant") return `${messages.length}|${last.id}`
  const part = last.content.at(-1)
  const size =
    part === undefined
      ? 0
      : part.type === "tool"
        ? part.state.status === "streaming"
          ? part.state.input.length
          : 0
        : part.text.length
  return `${last.id}|${last.time.completed ?? ""}|${last.content.length}|${part?.type === "tool" ? part.state.status : (part?.type ?? "")}|${size}`
}

/** What to add once nothing has changed for a while, worded as a fact rather than a spinner. */
export function quiet(activity: Activity, quietMs: number) {
  if (quietMs < QUIET_NOTICE_MS) return undefined
  if (activity.phase === "waiting") return "no response from the model yet"
  return "no new output yet"
}

/** A recorded guard intervention (stall warning, loop correction, tool timeout) as a status hint. */
export function guardHint(trip: { readonly guard: string; readonly detail: string }) {
  return `${trip.guard.replace(/_/g, " ")} guard: ${trip.detail.split("\n")[0]}`
}

export * as SessionActivity from "./session-activity"
