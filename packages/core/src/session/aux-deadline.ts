export * as AuxDeadline from "./aux-deadline.js"

export const TITLE_MS = 120_000
export const COMPACTION_MS = 600_000
export const JUDGE_MS = 60_000

export type Call = "title" | "compaction" | "judge"

const DEFAULTS: Record<Call, number> = { title: TITLE_MS, compaction: COMPACTION_MS, judge: JUDGE_MS }

export function deadlineMs(call: Call, configured?: number | false): number | undefined {
  if (configured === false) return undefined
  if (configured === undefined) return DEFAULTS[call]
  return configured > 0 ? configured : undefined
}

export function message(call: Call, ms: number) {
  const what =
    call === "title" ? "Naming the session" : call === "judge" ? "Judging the goal" : "Compacting the conversation"
  return `${what} got no answer from the provider within ${Math.round(ms / 1000)}s and was given up on.`
}
