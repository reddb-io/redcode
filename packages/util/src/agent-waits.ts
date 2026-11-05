/** A wait that is evidenced by an active tool call, not inferred from elapsed time. */
export type AgentWait = {
  id: string
  partID: string
  kind: "monitor" | "agent" | "task"
  target?: string
  since: number
}

type Message = {
  type: string
  id: string
  time: { completed?: number }
  content?: readonly {
    type: string
    id?: string
    name?: string
    state?: unknown
    time?: unknown
  }[]
}

/** No arbitrary tool arguments or URLs are surfaced in a status line. */
const identifier = (value: unknown) => (typeof value === "string" && /^[\w.-]{1,80}$/.test(value) ? value : undefined)

export function agentWaits(messages: readonly Message[]): AgentWait[] {
  return messages.flatMap((message) => {
    if (message.type !== "assistant" || message.time.completed !== undefined) return []
    return (message.content ?? []).flatMap<AgentWait>((part) => {
      if (part.type !== "tool" || !part.id || !part.time || typeof part.time !== "object") return []
      if (!part.state || typeof part.state !== "object" || !("status" in part.state) || part.state.status !== "running")
        return []
      const time = part.time as { created?: unknown; ran?: unknown }
      const since = typeof time.ran === "number" ? time.ran : time.created
      if (typeof since !== "number" || !Number.isFinite(since)) return []
      const input = "input" in part.state ? part.state.input : undefined
      if (!input || typeof input !== "object" || Array.isArray(input)) return []
      const args = input as Record<string, unknown>
      const id = `${message.id}:${part.id}`
      const partID = part.id
      if (part.name === "monitor" && args.action === "wait")
        return [{ id, partID, kind: "monitor" as const, target: identifier(args.id), since }]
      if (part.name === "subagent" && args.background !== true)
        return [{ id, partID, kind: "agent" as const, target: identifier(args.agent), since }]
      if (part.name === "redcode_background_wait")
        return [{ id, partID, kind: "task" as const, target: identifier(args.taskID), since }]
      return []
    })
  })
}
