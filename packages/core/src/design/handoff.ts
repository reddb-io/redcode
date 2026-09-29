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
      const approved = yield* designs.approve(sessionID, id, input.revision, input.variant)
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
