import { SessionPlan } from "@reddb-io/redcode-core/session/plan"
import path from "path"
import { createHash } from "node:crypto"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { Question } from "../question"
import { GoalRuntime } from "@/session/goal-runtime"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"

export const Parameters = Schema.Struct({})

export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const plans = yield* SessionPlan.Service
    const session = yield* Session.Service
    const goals = yield* GoalRuntime.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(instance.worktree, Session.plan(info, instance))
          const content = yield* Effect.tryPromise(() => Bun.file(path.resolve(instance.worktree, plan)).text())
          if (!content.trim()) return yield* Effect.die("The plan file is empty; finish it before requesting approval")
          const revision = createHash("sha256").update(content).digest("hex")
          const ready = yield* plans.record({
            sessionID: ctx.sessionID,
            revision,
            path: plan,
            content,
            status: "ready",
            created: Date.now(),
          })
          const goal = yield* goals.get(ctx.sessionID)
          if (goal?.status === "active" && goal.stopAfter === "plan")
            return {
              title: "Plan ready",
              output: `Plan-only goal: revision ${revision} is recorded and ready for review at ${plan}.`,
              metadata: { agent: "plan", revision },
            }
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `Execute plan ${plan} (revision ${revision})?\n\n${content}`,
                header: "Build Agent",
                custom: false,
                options: [
                  { label: "Yes", description: "Switch to build agent and start implementing the plan" },
                  { label: "No", description: "Stay with plan agent to continue refining the plan" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] !== "Yes") yield* new Question.RejectedError()
          const current = yield* Effect.tryPromise(() => Bun.file(path.resolve(instance.worktree, plan)).text())
          if (createHash("sha256").update(current).digest("hex") !== revision)
            return yield* Effect.die("Plan changed during approval; review the current revision before executing")

          yield* plans.record({ ...ready, status: "approved", created: Date.now() })
          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          const model =
            lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* provider.defaultModel()

          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `Plan ${plan}, revision ${revision}, has been approved. The immutable plan and Design decisions are supplied automatically in context. Execute within the approved scope.`,
            synthetic: true,
          } satisfies SessionV1.TextPart)

          return {
            title: "Switching to build agent",
            output: `User approved plan revision ${revision}. Switch to Build and execute the recorded plan.`,
            metadata: { agent: "build", revision },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
