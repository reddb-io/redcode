/**
 * How a surface folds S1 response repairs into one reply, read from message roles and the
 * `responseRepair` metadata a repair's synthetic text part carries.
 *
 * Import-free on purpose: the TUI and the web app both bundle it.
 */

type RepairPart = {
  readonly type: string
  readonly synthetic?: boolean
  readonly metadata?: Record<string, unknown>
}

/** The issues a response repair names, when the metadata carries one. */
export function responseRepairIssues(metadata: Record<string, unknown> | undefined) {
  const repair = metadata?.responseRepair
  if (typeof repair !== "object" || repair === null || !("issues" in repair) || !Array.isArray(repair.issues))
    return undefined
  return repair.issues.filter((issue): issue is string => typeof issue === "string")
}

/** The issues of the response repair a message's parts carry, when the message is one. */
export function responseRepair(parts: ReadonlyArray<RepairPart> | undefined) {
  return (parts ?? [])
    .map((part) => (part.type === "text" && part.synthetic ? responseRepairIssues(part.metadata) : undefined))
    .find((issues) => issues !== undefined)
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
  parts: Record<string, ReadonlyArray<RepairPart> | undefined>,
) {
  const repairs = new Map(
    messages.flatMap((message) => {
      if (message.role !== "user") return []
      const issues = responseRepair(parts[message.id])
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
