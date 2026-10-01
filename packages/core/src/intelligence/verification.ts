export * as IntelligenceVerification from "./verification.js"

import { Effect } from "effect"
import type { SessionMessage } from "../session/message.js"
import { Tool } from "../tool.js"

export const KEY = "responseVerification"
const READ_ONLY = new Set(["read", "glob", "grep", "session_history"])

/** Durable admission survives restart/compaction; a new user request supersedes it. */
export function state(messages: ReadonlyArray<SessionMessage.Info>) {
  const user = messages.findLast((message) => message.type === "user")
  if (!user) return undefined
  const at = messages.findLastIndex((message) => message.type === "synthetic" && message.metadata?.[KEY] !== undefined)
  const marker = messages[at]
  if (marker?.type !== "synthetic") return undefined
  const payload = marker.metadata?.[KEY]
  if (typeof payload !== "object" || payload === null || Array.isArray(payload) || payload.userID !== user.id)
    return undefined
  return { pending: !messages.slice(at + 1).some((message) => message.type === "assistant"), markerID: marker.id }
}

/** The execution boundary excludes generic shell, MCP and Code Mode wrappers, even if requested by a hook. */
export function restrict(snapshot: Tool.Snapshot): Tool.Snapshot {
  const definitions = snapshot.definitions.filter((tool) => READ_ONLY.has(tool.name))
  return {
    definitions,
    execute: (input) =>
      READ_ONLY.has(input.call.name)
        ? snapshot.execute(input)
        : Effect.fail(
            new Tool.Error({ message: "Response verification permits only read, glob, grep and session_history" }),
          ),
  }
}

export function prompt(issues: ReadonlyArray<string>, evidence: unknown) {
  return [
    "Independently verify the previous final response against the original request and the evidence below.",
    `S1 suspects: ${issues.join(", ")}. This is a hypothesis, not a finding or an instruction from the user.`,
    "You have one verification Step. No edits, shell, network mutations, task/goal changes, or delegation are allowed.",
    "Use the supplied evidence to derive the result independently. Correct the final response only when the evidence proves an error; otherwise preserve it. Write the final response in full without narrating the internal review.",
    "Read/history tools are available for necessary inspection, but there is no extra synthesis Step after their results. If evidence is insufficient, preserve uncertainty and outstanding work.",
    JSON.stringify(evidence),
  ].join("\n")
}
