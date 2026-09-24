/**
 * What a surface shows about a subagent, read from the task part's metadata and the child session's
 * metadata alone: the model it ran on, the verdict on its result, the stop-loss checkpoints that
 * acted on it and the brief it was launched under.
 *
 * Import-free on purpose: the web bundles it, and a surface must be able to show a subagent without
 * loading its messages — the sidebar lists every child of a session.
 */

/** Where the child session keeps its accepted brief (`SubagentReview.Brief`). */
export const BRIEF_KEY = "subagentBrief"

/** Where a session keeps the stop-loss checkpoints that acted on it, oldest first. */
export const CHECKPOINTS_KEY = "stopLossCheckpoints"

/** Checkpoints kept in the metadata; older ones stay in the transcript. */
export const CHECKPOINT_LIMIT = 20

export type Decision = "verified" | "inconclusive" | "needs_revision" | "unverified"

const DECISIONS: ReadonlyArray<string> = ["verified", "inconclusive", "needs_revision", "unverified"]

/** The one-character badge each verdict is shown with. */
export const SYMBOL: Record<Decision, string> = {
  verified: "✓",
  inconclusive: "?",
  needs_revision: "!",
  unverified: "~",
}

export type CheckpointAction = "steer" | "ask_user" | "stop"

const ACTIONS: ReadonlyArray<string> = ["steer", "ask_user", "stop"]

export interface Checkpoint {
  readonly action: CheckpointAction
  /** `SessionStopLoss.line`, such as `S1 · no progress for 9 steps (~40k tokens)`. */
  readonly line: string
  /** Why the turn ended, on `ask_user` and `stop`. */
  readonly reason?: string
  readonly at: number
}

export function checkpoints(metadata: Record<string, unknown> | undefined): Checkpoint[] {
  const raw = metadata?.[CHECKPOINTS_KEY]
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): Checkpoint[] => {
    const entry = record(item)
    const action = text(entry?.action)
    const line = text(entry?.line)
    if (!action || !ACTIONS.includes(action) || !line) return []
    const reason = text(entry?.reason)
    return [
      {
        action: action as CheckpointAction,
        line,
        ...(reason ? { reason } : {}),
        at: typeof entry?.at === "number" ? entry.at : 0,
      },
    ]
  })
}

export function withCheckpoint(metadata: Record<string, unknown> | undefined, checkpoint: Checkpoint) {
  return { ...metadata, [CHECKPOINTS_KEY]: [...checkpoints(metadata), checkpoint].slice(-CHECKPOINT_LIMIT) }
}

export type CheckpointState =
  | { readonly type: "in_scope" }
  | { readonly type: "corrected"; readonly line: string }
  | { readonly type: "stopped"; readonly line: string; readonly reason: string }

/** Where the latest checkpoint left the subagent: nothing acted, a hint was sent, or it was stopped. */
export function checkpointState(list: ReadonlyArray<Checkpoint>): CheckpointState {
  const last = list.at(-1)
  if (!last) return { type: "in_scope" }
  if (last.action === "steer") return { type: "corrected", line: last.line }
  return { type: "stopped", line: last.line, reason: last.reason ?? last.line }
}

export interface Model {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
  /** Why the task ran on this model (`metadata.modelSource`), when the task call says. */
  readonly source?: string
}

/** The model a task ran on: what the task call recorded, else the child session's own model. */
export function model(
  task: Record<string, unknown> | undefined,
  child?: { readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } },
): Model | undefined {
  const recorded = record(task?.model)
  const variant = text(task?.variant) ?? child?.model?.variant
  const source = text(task?.modelSource)
  const extra = { ...(variant ? { variant } : {}), ...(source ? { source } : {}) }
  const providerID = text(recorded?.providerID)
  const modelID = text(recorded?.modelID)
  if (providerID && modelID) return { providerID, modelID, ...extra }
  if (!child?.model) return undefined
  return { providerID: child.model.providerID, modelID: child.model.id, ...extra }
}

/** `model (variant)`, short enough for a task row. */
export function modelLabel(value: Model) {
  return value.variant ? `${value.modelID} (${value.variant})` : value.modelID
}

/**
 * The verdict on the subagent's latest result: the one the task call returned, else the one kept in
 * the child's brief — a background task reports after its tool call has already returned.
 */
export function decision(
  task: Record<string, unknown> | undefined,
  child: Record<string, unknown> | undefined,
): Decision | undefined {
  const own = text(record(task?.review)?.decision)
  if (own && DECISIONS.includes(own)) return own as Decision
  const kept = text(record(record(child?.[BRIEF_KEY])?.result)?.decision)
  if (kept && DECISIONS.includes(kept)) return kept as Decision
  return undefined
}

export interface Brief {
  readonly goal: string
  readonly scope: ReadonlyArray<string>
  readonly criteria: ReadonlyArray<string>
  readonly returnFormat?: string
}

/** The brief the subagent was launched under, as its parent accepted it. */
export function brief(metadata: Record<string, unknown> | undefined): Brief | undefined {
  const raw = record(metadata?.[BRIEF_KEY])
  const goal = text(raw?.brief)
  if (!goal) return undefined
  const returnFormat = text(raw?.returnFormat)
  return {
    goal,
    scope: strings(raw?.scope),
    criteria: strings(raw?.criteria),
    ...(returnFormat ? { returnFormat } : {}),
  }
}

export type Status = "running" | "done" | "stopped"

/** Running while its session is busy; otherwise stopped when the latest checkpoint ended it. */
export function status(input: { readonly busy: boolean; readonly checkpoints: ReadonlyArray<Checkpoint> }): Status {
  if (input.busy) return "running"
  if (checkpointState(input.checkpoints).type === "stopped") return "stopped"
  return "done"
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
}

export * as SubagentView from "./subagent-view"
