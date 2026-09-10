import { SessionTodo } from "@reddb-io/redcode-schema/session-todo"
import { Todo } from "../session/todo"
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
import { RepositoryGuard } from "@reddb-io/redcode-core/repository-guard"

export const Parameters = Schema.Struct({})
export const PlanParameters = Schema.Struct({ tasks: Schema.optional(Schema.Array(SessionTodo.PlanTask)) })

export const WorktreePrepareTool = Tool.define(
  "worktree_prepare",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return {
      description:
        "Run the mandatory repository preflight before coding. Create or reuse this session's linked worktree and return its absolute paths and status. The source checkout is preserved. Non-Git directories and YOLO keep their directory.",
      parameters: Parameters,
      execute: (_input: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          yield* ctx.ask({
            permission: "worktree_prepare",
            patterns: [instance.directory],
            always: [instance.directory],
            metadata: {},
          })
          const info = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          const plan = yield* Session.preparePlan(info, instance)
          const output = yield* Effect.promise(() => RepositoryGuard.preflight(instance.directory, ctx.sessionID, plan))
          return { title: "Repository preflight", output, metadata: {} }
        }),
    }
  }),
)

export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const plans = yield* SessionPlan.Service
    const todos = yield* Todo.Service
    const session = yield* Session.Service
    const goals = yield* GoalRuntime.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: PlanParameters,
      execute: (params: typeof PlanParameters.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(instance.worktree, yield* Session.preparePlan(info, instance))
          const content = yield* readPlan(path.resolve(instance.worktree, plan))
          if (!content.trim()) return yield* Effect.die("The plan file is empty; finish it before requesting approval")
          const revision = createHash("sha256").update(content).digest("hex")
          const previous = (yield* plans.list(ctx.sessionID)).find((entry) => entry.revision === revision)
          const ready = yield* plans.record({
            sessionID: ctx.sessionID,
            revision,
            path: plan,
            content,
            tasks: params.tasks ?? previous?.tasks,
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
          if (!ready.tasks?.length)
            return yield* Effect.die(
              "Before Build, call plan_exit with tasks covering every plan deliverable and verification: key, content, criterion and exact quote from the plan.",
            )
          const answers =
            previous?.status === "approved" && previous.tasks?.length
              ? [["Yes"]]
              : yield* question.ask({
                  sessionID: ctx.sessionID,
                  questions: [
                    {
                      question: `Execute plan ${plan} (revision ${revision})?\n\n${content}\n\nExecution tasks:\n${ready.tasks.map((task) => `- ${task.key}: ${task.content} — ${task.criterion}`).join("\n")}`,
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
          const current = yield* readPlan(path.resolve(instance.worktree, plan))
          if (createHash("sha256").update(current).digest("hex") !== revision)
            return yield* Effect.die("Plan changed during approval; review the current revision before executing")

          const latestGoal = yield* goals.get(ctx.sessionID)
          if (latestGoal?.id !== goal?.id || latestGoal?.updated !== goal?.updated)
            return yield* Effect.die("Goal changed during plan approval; inspect the current goal before executing")
          const approved = yield* plans.record({ ...ready, status: "approved", created: Date.now() })
          yield* todos.update({
            sessionID: ctx.sessionID,
            origin: { type: "plan", id: approved.revision, quote: approved.content, created: approved.created },
            todos: ready.tasks.map((task) => ({
              planKey: task.key,
              content: task.content,
              criterion: task.criterion,
              requirement: task.quote,
              status: "pending",
              priority: "high",
            })),
          })
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

          yield* session.setAgentModel({
            sessionID: ctx.sessionID,
            agent: "build",
            model: {
              id: model.modelID,
              providerID: model.providerID,
              variant: lastUser?.info.role === "user" ? lastUser.info.model.variant : undefined,
            },
            time: Date.now(),
          })

          return {
            title: "Switching to build agent",
            output: `User approved plan revision ${revision}. Switch to Build and execute the recorded plan.`,
            metadata: { agent: "build", revision },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function readPlan(file: string) {
  return Effect.tryPromise({
    try: () => Bun.file(file).text(),
    catch: (cause) =>
      new Error(
        cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? `Plan file not found at ${file}. Save the complete implementation plan to this exact file using write, then call plan_exit again to request approval. A plan written only in chat is not ready for execution.`
          : `Cannot read plan file ${file}: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
  })
}
