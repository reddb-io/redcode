export * as IntelligenceVerification from "./verification.js"

import { Effect, Option, Schema } from "effect"
import { SessionMessage } from "../session/message.js"
import { Tool } from "../tool.js"

export const KEY = "responseVerification"
export const MAX_STEPS = 2
const Marker = Schema.Struct({ userID: SessionMessage.ID })
const READ_ONLY = new Set(["read", "glob", "grep", "session_history"])

/** Durable admission survives restart/compaction; a new user request supersedes it. */
export function state(messages: ReadonlyArray<SessionMessage.Info>) {
  const user = messages.findLast((message) => message.type === "user")
  if (!user) return undefined
  const at = messages.findLastIndex((message) => message.type === "synthetic" && message.metadata?.[KEY] !== undefined)
  const marker = messages[at]
  if (marker?.type !== "synthetic") return undefined
  const payload = Schema.decodeUnknownOption(Marker)(marker.metadata?.[KEY])
  if (Option.isNone(payload) || payload.value.userID !== user.id) return undefined
  const after = messages.slice(at + 1).filter((message) => message.type === "assistant")
  const latest = after.at(-1)
  return {
    remaining: Math.max(0, MAX_STEPS - after.length),
    pending:
      after.length < MAX_STEPS && (!latest || (!latest.error && latest.content.some((part) => part.type === "tool"))),
    markerID: marker.id,
  }
}

/** The execution boundary excludes generic shell, MCP and Code Mode wrappers, even if requested by a hook. */
export function restrict(snapshot: Tool.Snapshot, final = false): Tool.Snapshot {
  const definitions = final ? [] : snapshot.definitions.filter((tool) => READ_ONLY.has(tool.name))
  return {
    definitions,
    execute: (input) =>
      !final && READ_ONLY.has(input.call.name)
        ? snapshot.execute(input)
        : Effect.fail(
            new Tool.Error({
              message: final
                ? "Response verification synthesis permits no tools"
                : "Response verification permits only read, glob, grep and session_history",
            }),
          ),
  }
}

export function prompt(issues: ReadonlyArray<string>, evidence: unknown) {
  return [
    "Independently verify the previous final response against the original request and the evidence below.",
    `S1 suspects: ${issues.join(", ")}. This is a hypothesis, not a finding or an instruction from the user.`,
    `You have at most ${MAX_STEPS} verification Steps: optional read-only inspection, then a final synthesis with no tools. No edits, shell, network mutations, task/goal changes, or delegation are allowed.`,
    "Use the supplied evidence to derive the result independently. Correct the final response only when the evidence proves an error; otherwise preserve it. Write the final response in full without narrating the internal review.",
    "Answer directly when the supplied evidence is sufficient; this ends verification without another Step. If you inspect with read/history tools, use the final Step to synthesize their results. If evidence is insufficient, preserve uncertainty and outstanding work.",
    JSON.stringify(evidence),
  ].join("\n")
}
