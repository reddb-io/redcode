import { SubagentView } from "@reddb-io/redcode-core/session/subagent-view"

export type TaskCardTone = "muted" | "success" | "warning" | "critical"

export type TaskCardSegment = { text: string; tone: TaskCardTone }

const DECISION_TONE: Record<SubagentView.Decision, TaskCardTone> = {
  verified: "success",
  inconclusive: "warning",
  needs_revision: "critical",
  unverified: "muted",
}

const VERDICT: Record<SubagentView.Decision, string> = {
  verified: "verified",
  inconclusive: "inconclusive",
  needs_revision: "needs revision",
  unverified: "unverified",
}

/**
 * The line under a task card's title: the model it ran on, the verdict on its result and where the
 * stop-loss checkpoints left it, read from the task part and the child session's metadata.
 */
export function taskCardDetail(
  metadata: Record<string, unknown>,
  child?: {
    model?: { id: string; providerID: string; variant?: string }
    metadata?: Record<string, unknown>
  },
): TaskCardSegment[] {
  const model = SubagentView.model(metadata, child)
  const decision = SubagentView.decision(metadata, child?.metadata)
  const checkpoint = SubagentView.checkpointState(SubagentView.checkpoints(child?.metadata))
  return [
    ...(model ? [{ text: SubagentView.modelLabel(model), tone: "muted" as const }] : []),
    ...(decision
      ? [
          {
            text: `${SubagentView.SYMBOL[decision]} ${VERDICT[decision]}`,
            tone: DECISION_TONE[decision],
          },
        ]
      : []),
    checkpoint.type === "stopped"
      ? { text: `stopped · ${checkpoint.reason}`, tone: "critical" }
      : checkpoint.type === "corrected"
        ? { text: "corrected (hint sent)", tone: "warning" }
        : { text: "in scope", tone: "muted" },
  ]
}