export * as DesignExitTool from "./design-exit.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Design } from "@opencode/schema/design"
import { Effect, Schema } from "effect"
import { DesignApproval } from "../../design/approval.js"
import { DesignHandoff } from "../../design/handoff.js"
import { DesignRounds } from "../../design/rounds.js"
import { DesignStore } from "../../design/store.js"
import { Form } from "../../form.js"
import { Permission } from "../../permission.js"
import { SessionGoal } from "../../session/goal.js"
import { Session } from "../../session.js"
import { SessionExecution } from "../../session/execution.js"

export const Plugin = {
  id: "redcode.tool.design-exit",
  effect: Effect.fn("DesignExitTool.Plugin")(function* (ctx: Context) {
    const designs = yield* DesignStore.Service
    const forms = yield* Form.Service
    const goals = yield* SessionGoal.Service
    const sessions = yield* Session.Service
    const execution = yield* SessionExecution.Service
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: "design_exit",
          options: { codemode: false },
          description:
            "Ask the user to approve a published Design revision, record its immutable handoff, and continue in Plan in this Session. Open feedback notes block approval.",
          input: Schema.Struct({
            id: Design.ID,
            variant: Schema.optional(Design.Variant),
            noTargets: Schema.optional(Schema.Boolean).annotate({ description: DesignApproval.NO_TARGETS }),
          }),
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "design_exit",
                resources: [input.id],
                save: [input.id],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const document = yield* designs.get(context.sessionID, input.id)
              if (!document.revision)
                return yield* new Design.Error({ code: "conflict", message: "Publish the design before approval" })
              if (DesignApproval.missingTargets(document, input.noTargets))
                return { output: DesignApproval.TARGETS_NUDGE, content: DesignApproval.TARGETS_NUDGE }
              const pending = DesignRounds.blocking(document)
              if (pending)
                return yield* new Design.Error({ code: "conflict", message: `Approval is not possible yet. ${pending}` })
              const goal = yield* goals.get(context.sessionID)
              const stay = goal?.status === "active" && goal.stopAfter === "design"
              const answer = yield* forms.ask({
                sessionID: context.sessionID,
                title: "Design approval",
                metadata: { kind: "question", tool: { messageID: context.messageID, id: context.id } },
                fields: [
                  {
                    key: "choice",
                    title: "Design approval",
                    description: `Approve ${document.name}, revision ${document.revision}, ${input.variant ? `variant ${input.variant.name} (${input.variant.id})` : "entire revision"}? Open questions: ${document.questions.join("; ") || "none"}`,
                    type: "string",
                    options: [
                      {
                        value: "Approve",
                        label: "Approve",
                        description: stay ? "Record this revision and stay in Design" : "Record this revision and continue in Plan",
                      },
                      { value: "Continue", label: "Continue", description: "Keep reviewing" },
                    ],
                    custom: false,
                  },
                ],
              })
              if (answer.status !== "answered" || answer.answer.choice !== "Approve") {
                const output = "The user chose to continue reviewing."
                return { output, content: output }
              }
              const current = yield* goals.get(context.sessionID)
              if (current?.id !== goal?.id || current?.revision !== goal?.revision)
                return yield* new Design.Error({
                  code: "conflict",
                  message: "Goal changed during approval; review the current scope again",
                })
              const latest = yield* designs.get(context.sessionID, input.id)
              if (
                latest.revision !== document.revision ||
                DesignRounds.blocking(latest) ||
                DesignApproval.missingTargets(latest, input.noTargets)
              )
                return yield* new Design.Error({
                  code: "conflict",
                  message: "Design changed during approval; review the latest revision and feedback again",
                })
              const approved = yield* DesignHandoff.approve(context.sessionID, input.id, {
                revision: document.revision,
                variant: input.variant,
              }).pipe(
                Effect.provideService(Session.Service, sessions),
                Effect.provideService(SessionExecution.Service, execution),
                Effect.provideService(DesignStore.Service, designs),
                Effect.provideService(SessionGoal.Service, goals),
              )
              const output = `Approved ${approved.revision}. Handoff: ${approved.plan}. Continue in ${approved.agent}.`
              return { output, content: output, metadata: { designID: input.id, revision: approved.revision } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
