import type { Part } from "@reddb-io/redcode-sdk/v2"

/**
 * The line a response repair shows between the answer it revised and the revision, when the
 * metadata carries one: the two read as one reply rather than the agent answering itself.
 */
export function responseRepairLine(metadata: Record<string, unknown> | undefined) {
  const repair = metadata?.responseRepair
  if (typeof repair !== "object" || repair === null || !("issues" in repair) || !Array.isArray(repair.issues))
    return undefined
  const issues = repair.issues.filter((issue): issue is string => typeof issue === "string")
  return `revised after S1 review${issues.length ? `: ${issues.join(", ")}` : ""}`
}

/** Whether the message at `index` is an answer a response repair revised: the next message is that repair. */
export function revisedAnswer(
  messages: ReadonlyArray<{ id: string; role: string }>,
  parts: Record<string, ReadonlyArray<Part> | undefined>,
  index: number,
) {
  const next = messages[index + 1]
  return (
    messages[index]?.role === "assistant" &&
    next?.role === "user" &&
    (parts[next.id] ?? []).some(
      (part) => part.type === "text" && part.synthetic === true && responseRepairLine(part.metadata) !== undefined,
    )
  )
}
