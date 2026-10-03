export * as DesignHandoff from "./handoff.js"

import { createHash } from "node:crypto"
import { Design } from "@opencode/schema/design"
import { DesignNotice } from "@opencode/schema/design-notice"
import { Agent } from "../agent.js"
import { Effect } from "effect"
import { Session } from "../session.js"
import { SessionExecution } from "../session/execution.js"
import { SessionGoal } from "../session/goal.js"
import { SessionInbox } from "../session/inbox.js"
import { SessionMessage } from "../session/message.js"
import { SessionSchema } from "../session/schema.js"
import { DesignApproval } from "./approval.js"
import { DesignStore } from "./store.js"
import { DesignCapture } from "./capture.js"

/** Commit explicit approval and hand the same durable Session to Plan. */
export const approve = Effect.fn("DesignHandoff.approve")(function* (
  sessionID: SessionSchema.ID,
  id: Design.ID,
  input: Design.Approve,
) {
  const designs = yield* DesignStore.Service
  const sessions = yield* Session.Service
  const execution = yield* SessionExecution.Service
  const goals = yield* SessionGoal.Service
  return yield* SessionInbox.serialized(
    sessionID,
    Effect.gen(function* () {
      const before = yield* designs.get(sessionID, id)
      const session = yield* sessions.get(sessionID)
      const approved = yield* designs.approve(sessionID, id, input.revision, input.variant, input.screenshot)
      const record = yield* designs.approval(sessionID, id, input.revision)
      const goal = yield* goals.get(sessionID)
      if (goal?.status === "active" && goal.stopAfter === "design")
        return { ...approved, agent: "design" as const, resume: false }
      if (before.approvedRevision === input.revision && session.agent === "plan") {
        yield* execution.wake(sessionID)
        return { ...approved, agent: "plan" as const, resume: false }
      }
      const messageID = SessionMessage.ID.make(
        `msg_design_approval_${createHash("sha256").update(`${sessionID}:${id}:${input.revision}`).digest("hex").slice(0, 32)}`,
      )
      if (record.screenshot) {
        const reference = DesignCapture.validate(record.screenshot, record.revision.id, record.variant ?? undefined)
        const bytes = yield* designs.readBlob(record.screenshot.hash)
        const image = yield* sessions
          .prompt({
            sessionID,
            id: SessionMessage.ID.make(`${messageID}_image`),
            text: DesignCapture.describe(record.screenshot, reference),
            files: [
              {
                uri: `data:${record.screenshot.mime};base64,${Buffer.from(bytes).toString("base64")}`,
                name: record.screenshot.name,
              },
            ],
            metadata: { source: "design.approval.reference", designID: id, revision: input.revision },
            delivery: "steer",
            resume: false,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new Design.Error({ code: "conflict", message: error instanceof Error ? error.message : String(error) }),
            ),
          )
        if (
          image.payload.metadata?.source !== "design.approval.reference" ||
          image.payload.metadata.designID !== id ||
          image.payload.metadata.revision !== input.revision
        )
          return yield* new Design.Error({ code: "conflict", message: "Design reference message ID is already in use" })
      }
      const admitted = yield* sessions.synthetic({
        sessionID,
        id: messageID,
        text: [
          // Clients rebuild the approval card from this line, so it comes from the shared envelope.
          DesignNotice.approvalLine({
            name: record.revision.document.name,
            revision: input.revision,
            variant: record.variant,
          }),
          `Design plan: ${approved.plan}`,
          DesignApproval.guidance(DesignApproval.summary(record)),
        ].join("\n\n"),
        metadata: { source: "design.approval", designID: id, revision: input.revision },
        resume: false,
      })
      if (
        admitted.type !== "synthetic" ||
        admitted.payload.metadata?.source !== "design.approval" ||
        admitted.payload.metadata.designID !== id ||
        admitted.payload.metadata.revision !== input.revision
      )
        return yield* new Design.Error({ code: "conflict", message: "Design handoff message ID is already in use" })
      if (session.agent !== "plan") yield* sessions.switchAgent({ sessionID, agent: Agent.ID.make("plan") })
      yield* execution.wake(sessionID)
      return { ...approved, agent: "plan" as const, resume: true }
    }).pipe(Effect.uninterruptible),
  )
})
