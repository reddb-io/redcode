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

/**
 * Plain-language reasons for the `responseQuestions` ids in `../intelligence`, shown to the user
 * in place of the raw question key. Every surface that names a response-review issue reads it
 * through `responseQuestionReason` so the wording stays in one place.
 */
export const responseQuestionReasons: Record<string, string> = {
  refusal: "refused or warned without cause",
  omission: "missed part of your request",
  unsupported: "claimed work it couldn't prove",
  tool_evidence: "relied on a failed or unrelated result",
  premature: "said done with work still open",
  writing: "was hard to follow",
}

/** The plain-language reason for a response-review question id, or a generic one for an unknown key. */
export function responseQuestionReason(id: string) {
  return responseQuestionReasons[id] ?? "didn't pass S1 review"
}

/** The issues a response repair names, when the metadata carries one. */
export function responseRepairIssues(metadata: Record<string, unknown> | undefined) {
  const repair = metadata?.responseRepair
  if (typeof repair !== "object" || repair === null || !("issues" in repair) || !Array.isArray(repair.issues))
    return undefined
  return repair.issues.filter((issue): issue is string => typeof issue === "string")
}

/** The confidence S1 gave each issue a response repair names, when the metadata carries one. */
export function responseRepairConfidence(metadata: Record<string, unknown> | undefined) {
  const repair = metadata?.responseRepair
  if (typeof repair !== "object" || repair === null || !("confidence" in repair)) return {}
  const confidence = repair.confidence
  if (typeof confidence !== "object" || confidence === null) return {}
  return Object.fromEntries(
    Object.entries(confidence).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  )
}

/** The issues and their confidence of the response repair a message's parts carry, when the message is one. */
export function responseRepairDetail(parts: ReadonlyArray<RepairPart> | undefined) {
  for (const part of parts ?? []) {
    if (part.type !== "text" || !part.synthetic) continue
    const issues = responseRepairIssues(part.metadata)
    if (issues) return { issues, confidence: responseRepairConfidence(part.metadata) }
  }
  return undefined
}

/** The issues of the response repair a message's parts carry, when the message is one. */
export function responseRepair(parts: ReadonlyArray<RepairPart> | undefined) {
  return responseRepairDetail(parts)?.issues
}

/**
 * How S1 response repairs fold a turn's attempts into one reply. The answer a repair revised is
 * `superseded`: its text and thought give way to the revision, while its tool calls stay in place
 * because they really ran. The last assistant message after the repairs carries the revision `note`,
 * which names the issues, their confidence and keeps the superseded answers for the user to open. A
 * repair nothing has answered yet is `pending`, and its answer stays visible until the revision starts.
 */
export function responseRevisions(
  messages: ReadonlyArray<{ id: string; role: string }>,
  parts: Record<string, ReadonlyArray<RepairPart> | undefined>,
) {
  const repairs = new Map(
    messages.flatMap((message) => {
      if (message.role !== "user") return []
      const detail = responseRepairDetail(parts[message.id])
      return detail ? [[message.id, detail] as const] : []
    }),
  )
  const superseded = new Set<string>()
  const pending = new Set<string>()
  const notes = new Map<string, { issues: string[]; originals: string[]; confidence: Record<string, number> }>()
  messages.forEach((message, index) => {
    const detail = repairs.get(message.id)
    const original = messages[index - 1]
    if (!detail || original?.role !== "assistant") return
    // The reply runs until the next prompt the user wrote; a later repair extends it.
    const end = messages.findIndex((next, at) => at > index && next.role === "user" && !repairs.has(next.id))
    const revision = messages
      .slice(index + 1, end === -1 ? undefined : end)
      .findLast((next) => next.role === "assistant")
    if (!revision) return void pending.add(message.id)
    superseded.add(original.id)
    const note = notes.get(revision.id)
    notes.set(revision.id, {
      issues: [...new Set([...(note?.issues ?? []), ...detail.issues])],
      originals: [...(note?.originals ?? []), original.id],
      confidence: { ...(note?.confidence ?? {}), ...detail.confidence },
    })
  })
  return { superseded, pending, notes }
}
