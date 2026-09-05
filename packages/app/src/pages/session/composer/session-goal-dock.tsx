import { createMemo } from "solid-js"

/**
 * The goal as one line above the composer. Read off the session record the sync already
 * carries, so it says what the server knows and needs no event of its own.
 */
export function goalLine(metadata: Record<string, unknown> | undefined) {
  const goal = metadata?.["goal"]
  if (!goal || typeof goal !== "object") return undefined
  const g = goal as Record<string, unknown>
  const status = String(g["status"] ?? "")
  if (!status || status === "dropped") return undefined
  const turns = g["turns"] as { used?: number; max?: number } | undefined
  const used = typeof turns?.used === "number" ? turns.used : 0
  const max = typeof turns?.max === "number" ? turns.max : 0
  const objective = typeof g["objective"] === "string" ? g["objective"] : ""
  const reason = typeof g["reason"] === "string" ? g["reason"] : ""
  if (status === "active")
    return { tone: "active" as const, label: `turn ${Math.min(used + 1, max)}/${max}`, objective }
  if (status === "done") return { tone: "done" as const, label: "done", objective }
  return { tone: "paused" as const, label: reason ? `${status} — ${reason}` : status, objective }
}

export function SessionGoalDock(props: { metadata: Record<string, unknown> | undefined }) {
  const line = createMemo(() => goalLine(props.metadata))
  return (
    <>
      {line() && (
        <div
          data-component="session-goal-dock"
          data-tone={line()!.tone}
          class="flex items-center gap-2 px-3 py-1.5 text-12-regular text-text-weak border-b border-border-weak-base"
          title={line()!.objective}
        >
          <span
            class="shrink-0 rounded-full px-1.5 py-0.5 text-11-medium"
            classList={{
              "bg-surface-raised-base text-text-strong": line()!.tone === "active",
              "bg-surface-success-base text-text-success": line()!.tone === "done",
              "bg-surface-warning-base text-text-warning": line()!.tone === "paused",
            }}
          >
            goal · {line()!.label}
          </span>
          <span class="truncate">{line()!.objective}</span>
        </div>
      )}
    </>
  )
}
