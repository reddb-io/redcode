export * as DesignCollaborationTool from "./design-collaboration.js"

import { createHash } from "node:crypto"
import { Effect, Schema } from "effect"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Design } from "@opencode/schema/design"
import { Agent } from "@opencode/schema/agent"
import { SessionMessage } from "@opencode/schema/session-message"
import { DesignCollaboration } from "../../design/collaboration.js"
import { DesignStore } from "../../design/store.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionExecution } from "../../session/execution.js"
import { SessionInbox } from "../../session/inbox.js"

export const Input = Schema.Struct({
  action: Schema.Literals(["inspect", "define", "handoff"]),
  id: Design.ID,
  expectedVersion: Schema.optional(Design.DefineDelivery.fields.expectedVersion),
  contract: Schema.optional(Design.DeliveryContract),
  to: Schema.optional(Design.CreativeRole),
  revision: Schema.optional(Schema.NonEmptyString),
  summary: Schema.optional(Schema.NonEmptyString),
}).pipe(
  Schema.decodeTo(
    Schema.Union([
      Schema.Struct({ action: Schema.Literal("inspect"), id: Design.ID }),
      Schema.Struct({ id: Design.ID, ...Design.DefineDelivery.fields }),
      Schema.Struct({ id: Design.ID, ...Design.HandoffDelivery.fields }),
    ]),
  ),
)

export const Plugin = {
  id: "redcode.tool.design-collaboration",
  effect: Effect.fn("DesignCollaborationTool.Plugin")(function* (ctx: Context) {
    const designs = yield* DesignStore.Service
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const execution = yield* SessionExecution.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: "design_collaboration",
          options: { codemode: false },
          description:
            "Inspect or define complementary delivery contracts on an existing Design document, then hand the same document and Session between Design and Creator. Design owns interface acceptance/states; Creator owns a functional artifact (preview/component/files) or extension (SDK target, entry, capabilities, source/package/instructions). Define requires expectedVersion (0 initially) and your role's contract. Handoff requires the latest published revision, the complementary role and a summary; provide its contract on first transfer, omit it to preserve an existing recipient contract. Handoff requests permission and switches mode in the same conversation, preserving files, feedback, revisions and user approval. It is not completion or approval. Inspect before changing; retrying the same handoff finishes that transfer instead of creating another document or message.",
          input: Input,
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
              yield* permission.assert({
                action: "design_collaboration",
                resources: [input.id],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              if (input.action === "inspect") {
                const document = yield* designs.get(context.sessionID, input.id)
                const output = JSON.stringify({
                  id: document.id,
                  revision: document.revision,
                  root: document.root,
                  expectedVersion: document.collaboration?.version ?? 0,
                  collaboration: document.collaboration ?? null,
                })
                return { output, content: output }
              }
              const actor = context.agent === "design" ? "design" : context.agent === "creator" ? "creator" : undefined
              if (!actor)
                return yield* new Design.Error({
                  code: "invalid",
                  message: "Only Design and Creator author delivery contracts; other modes can inspect them",
                })
              yield* permission.assert({
                action: input.action === "handoff" ? "design_handoff" : "design_edit",
                resources: [input.id],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              const document =
                input.action === "define"
                  ? yield* designs.collaborate(context.sessionID, input.id, actor, input)
                  : yield* SessionInbox.serialized(
                      context.sessionID,
                      Effect.gen(function* () {
                        const session = yield* sessions.get(context.sessionID)
                        if (session.agent !== actor && session.agent !== input.to)
                          return yield* new Design.Error({
                            code: "conflict",
                            message: "The selected mode changed; inspect the document before handing off",
                          })
                        const document = yield* designs.collaborate(context.sessionID, input.id, actor, input)
                        const workflow = document.collaboration!
                        const id = SessionMessage.ID.make(
                          `msg_creative_handoff_${createHash("sha256").update(`${context.sessionID}:${input.id}:${workflow.version}`).digest("hex").slice(0, 32)}`,
                        )
                        const admitted = yield* sessions.synthetic({
                          sessionID: context.sessionID,
                          id,
                          resume: false,
                          text: `Continue ${document.name} on document ${document.id}, work root ${document.root}.\n${DesignCollaboration.guidance(workflow)}`,
                          metadata: {
                            source: "design.collaboration",
                            designID: document.id,
                            revision: input.revision,
                            workflowVersion: workflow.version,
                          },
                        })
                        if (
                          admitted.type !== "synthetic" ||
                          admitted.payload.metadata?.source !== "design.collaboration" ||
                          admitted.payload.metadata.designID !== document.id ||
                          admitted.payload.metadata.workflowVersion !== workflow.version
                        )
                          return yield* new Design.Error({
                            code: "conflict",
                            message: "Creative handoff message ID is already in use",
                          })
                        if (session.agent !== input.to)
                          yield* sessions.switchAgent({ sessionID: context.sessionID, agent: Agent.ID.make(input.to) })
                        yield* execution.wake(context.sessionID)
                        return document
                      }).pipe(Effect.uninterruptible),
                    )
              const output = `Document ${document.id}; work root ${document.root}.\n${DesignCollaboration.guidance(document.collaboration!)}`
              return {
                output,
                content: output,
                metadata: {
                  designID: document.id,
                  revision: document.revision,
                  workflowVersion: document.collaboration!.version,
                },
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
