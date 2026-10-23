export * as SubagentCompletion from "./subagent-completion.js"

import { SubagentReview } from "@opencode/schema/subagent-review"
import type { SessionSchema } from "./schema.js"
import { Effect } from "effect"
import type { Job } from "../job.js"
import type { Session } from "../session.js"
import type { SessionMessage } from "./message.js"

export const NO_TEXT = "Subagent completed without a text response."

export function text(message: SessionMessage.Info | undefined) {
  if (message?.type !== "assistant") return NO_TEXT
  return (
    message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter((text) => text.length > 0)
      .join("\n\n") || NO_TEXT
  )
}

export const deliver = Effect.fnUntraced(function* (
  sessions: Pick<Session.Interface, "synthetic">,
  jobs: Pick<Job.Interface, "completeBackground">,
  input: Pick<Job.Info, "status" | "output" | "error" | "notificationID"> & {
    recovery: Extract<Job.Recovery, { kind: "subagent" }>
    resume?: boolean
  },
) {
  if (input.status === "running") return
  const recovery = input.recovery
  const text =
    input.status === "completed"
      ? (input.output ?? NO_TEXT)
      : input.status === "error"
        ? (input.error ?? "Subagent failed")
        : "Subagent cancelled"
  yield* sessions.synthetic({
    ...(input.notificationID ? { id: input.notificationID } : {}),
    sessionID: recovery.parentSessionID,
    ...(input.resume === false ? { resume: false } : {}),
    description: recovery.description,
    text: `<subagent sessionID="${recovery.childSessionID}" state="${input.status}" description="${recovery.description}">\n${text}\n</subagent>`,
    metadata: { source: "subagent", childID: recovery.childSessionID, agent: recovery.agent, state: input.status },
  })
  if (input.notificationID) yield* jobs.completeBackground(input.notificationID)
})

/** Preserve terminal job outcomes separately from the Session's last execution and result review. */
export const record = Effect.fnUntraced(function* (
  sessions: Pick<Session.Interface, "get" | "setMetadata">,
  input: {
    childSessionID: SessionSchema.ID
    promptID?: string
    status: "completed" | "error" | "cancelled"
    error?: string
  },
) {
  if (!input.promptID) return
  const child = yield* sessions
    .get(input.childSessionID)
    .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined)))
  const brief = SubagentReview.read(child?.metadata)
  if (!child || !brief?.task || brief.task.promptID !== input.promptID) return
  if (
    brief.completion?.promptID === brief.task.promptID &&
    brief.completion.status === input.status &&
    brief.completion.error === input.error?.slice(0, 2_000)
  )
    return
  yield* sessions
    .setMetadata({
      sessionID: child.id,
      metadata: SubagentReview.write(child.metadata, {
        ...brief,
        completion: {
          promptID: brief.task.promptID,
          status: input.status,
          at: Date.now(),
          ...(input.error ? { error: input.error.slice(0, 2_000) } : {}),
        },
      }),
    })
    .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.void))
})
