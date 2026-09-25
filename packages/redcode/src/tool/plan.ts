import { SessionTodo } from "@reddb-io/redcode-schema/session-todo"
import { Todo } from "../session/todo"
import { SessionPlan } from "@reddb-io/redcode-core/session/plan"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { SessionTaskFacts } from "@reddb-io/redcode-core/session/task-facts"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionInput } from "@reddb-io/redcode-core/session/input"
import path from "path"
import { createHash } from "node:crypto"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Effect, Option, Schema } from "effect"
import { Config } from "@/config/config"
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
import { AutoWorktree } from "@/session/auto-worktree"
import { EventV2Bridge } from "@/event-v2-bridge"

export const Parameters = Schema.Struct({})
export const PlanParameters = Schema.Struct({ tasks: Schema.optional(Schema.Array(SessionTodo.PlanTask)) })

export const WorktreePrepareTool = Tool.define(
  "worktree_prepare",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    // Optional so the tool still builds where no config is provided; the registry always has one.
    const config = Option.getOrUndefined(yield* Effect.serviceOption(Config.Service))
    const events = yield* EventV2Bridge.Service
    return {
      description:
        "Create or reuse this session's linked worktree now instead of on the first edit, and return its absolute paths, branch and status. The harness moves the session into it, in YOLO mode too; the source checkout is preserved. Non-Git directories, and sessions with automatic worktrees turned off, keep their directory.",
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
          // Writing agents get the same session worktree the first edit would create; plan and design keep theirs.
          const claim = yield* AutoWorktree.ensure({
            sessions,
            events,
            config,
            sessionID: ctx.sessionID,
            agent: ctx.agent,
          })
          const directory = claim
            ? yield* Effect.promise(() => RepositoryGuard.relocate(claim, instance.directory))
            : instance.directory
          const plan = yield* Session.preparePlan(
            info,
            claim ? { ...instance, directory, worktree: claim.worktree } : instance,
          )
          const output = yield* Effect.promise(() => RepositoryGuard.preflight(directory, ctx.sessionID, plan))
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
    const intelligence = yield* Intelligence.Service
    const facts = yield* SessionTaskFacts.Service
    const database = yield* Database.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: PlanParameters,
      execute: (params: typeof PlanParameters.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const settings = yield* intelligence.read()
          yield* Intelligence.requireConfigured(settings)
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(instance.worktree, yield* Session.preparePlan(info, instance))
          const content = yield* readPlan(path.resolve(instance.worktree, plan))
          if (!content.trim()) return yield* Effect.die("The plan file is empty; finish it before requesting approval")
          const revision = createHash("sha256").update(content).digest("hex")
          const previous = (yield* plans.list(ctx.sessionID)).find((entry) => entry.revision === revision)
          const tasks = params.tasks ?? previous?.tasks
          const problem = SessionPlan.validationError({ content, tasks })
          if (problem) return yield* Effect.die(problem)
          const sourceRequests = (yield* facts.load(ctx.sessionID)).requests
          const requests = sourceRequests.filter((request) => !request.pending)
          const evaluation = yield* intelligence.evaluate({
            sessionID: ctx.sessionID,
            operation: "plan",
            candidateID: revision,
            ...SessionPlan.review({ requests, content, path: plan, reference: ctx.sessionID, tasks }),
          })
          // S1 informs the user's decision and never blocks it: the approval question is always asked.
          const review = SessionPlan.verdict(
            settings,
            evaluation,
            evaluation ? yield* intelligence.history(ctx.sessionID, { operation: "plan", limit: 20 }) : [],
          )
          yield* ctx.metadata({ metadata: { review: review.text } })
          if (
            createHash("sha256")
              .update(yield* readPlan(path.resolve(instance.worktree, plan)))
              .digest("hex") !== revision ||
            Intelligence.fingerprint(requests) !==
              Intelligence.fingerprint(
                (yield* facts.load(ctx.sessionID)).requests.filter((request) => !request.pending),
              )
          )
            return yield* Effect.die("Plan sources changed during evaluation; retry")
          yield* Intelligence.requireConfigured(yield* intelligence.read())
          const ready = yield* plans.record({
            sessionID: ctx.sessionID,
            revision,
            path: plan,
            content,
            tasks,
            status: "ready",
            created: Date.now(),
          })
          const goal = yield* goals.get(ctx.sessionID)
          if (goal?.status === "active" && goal.stopAfter === "plan")
            return {
              title: "Plan ready",
              output: `Plan-only goal: revision ${revision} is recorded and ready for review at ${plan}.\n${review.text}`,
              metadata: { agent: "plan", revision, review: review.text },
            }
          if (!ready.tasks?.length)
            return yield* Effect.die(
              "Before Build, call plan_exit with tasks covering every plan deliverable and verification: key, content, criterion and exact quote from the plan.",
            )
          const answers =
            previous?.status === "approved" && previous.tasks?.length
              ? [["Yes"]]
              : yield* question
                  .ask({
                    sessionID: ctx.sessionID,
                    questions: [
                      {
                        question: `Execute plan ${plan} (revision ${revision})?\n\n${content}\n\nExecution tasks:\n${ready.tasks.map((task) => `- ${task.key}: ${task.content} — ${task.criterion}`).join("\n")}\n\n${review.text}`,
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
                  .pipe(
                    Effect.catchTag("QuestionRejectedError", () =>
                      Effect.fail(new Question.RejectedError({ detail: review.text })),
                    ),
                  )

          if (answers[0]?.[0] !== "Yes") yield* new Question.RejectedError({ detail: review.text })
          const current = yield* readPlan(path.resolve(instance.worktree, plan))
          if (createHash("sha256").update(current).digest("hex") !== revision)
            return yield* Effect.die("Plan changed during approval; review the current revision before executing")

          const latestGoal = yield* goals.get(ctx.sessionID)
          if (latestGoal?.id !== goal?.id || latestGoal?.updated !== goal?.updated)
            return yield* Effect.die("Goal changed during plan approval; inspect the current goal before executing")
          yield* Intelligence.requireConfigured(yield* intelligence.read())
          const approved = { ...ready, status: "approved" as const, created: Date.now() }
          const admitted = yield* todos.write(
            {
              sessionID: ctx.sessionID,
              origin: { type: "plan", id: ready.revision, quote: ready.content, created: ready.created },
              todos: ready.tasks.map((task) => ({
                planKey: task.key,
                content: task.content,
                criterion: task.criterion,
                requirement: task.quote,
                status: "pending",
                priority: "high",
              })),
            },
            {
              before: Effect.gen(function* () {
                if (
                  createHash("sha256")
                    .update(yield* readPlan(path.resolve(instance.worktree, plan)))
                    .digest("hex") !== revision
                )
                  return yield* new SessionTodo.Error({
                    message: "Plan changed while admitting tasks; review the current revision",
                  })
                yield* Intelligence.requireConfigured(yield* intelligence.read())
              }).pipe(Effect.mapError((error) => new SessionTodo.Error({ message: error.message }))),
              write: plans
                .record(
                  approved,
                  Effect.gen(function* () {
                    const currentGoal = yield* goals.get(ctx.sessionID)
                    return (
                      currentGoal?.id === goal?.id &&
                      currentGoal?.updated === goal?.updated &&
                      Intelligence.fingerprint(sourceRequests) ===
                        Intelligence.fingerprint((yield* facts.load(ctx.sessionID)).requests) &&
                      !(yield* SessionInput.hasPending(database.db, ctx.sessionID, "steer"))
                    )
                  }),
                )
                .pipe(
                  Effect.asVoid,
                  Effect.mapError((error) => new SessionTodo.Error({ message: error.message })),
                ),
            },
          )
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
            output: [
              `User approved plan revision ${revision}. Switch to Build and execute the recorded plan. If the plan implements an approved Design, follow its implementation contract.`,
              review.decision === "needs_revision" || review.decision === "inconclusive"
                ? `The user approved it over this review; weigh it while executing. ${review.text}`
                : review.text,
              ...admitted.notes,
            ].join("\n"),
            metadata: { agent: "build", revision, review: review.text },
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
