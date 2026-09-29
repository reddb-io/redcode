export * as PlanExitTool from "./plan-exit.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import { SessionTodo } from "@opencode/schema/session-todo"
import { Effect, Schema } from "effect"
import { Database } from "../../database/database.js"
import { FileAccess } from "../../file-access.js"
import { Form } from "../../form.js"
import { Intelligence } from "../../intelligence.js"
import { IntelligenceEvaluation } from "../../intelligence/evaluation.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionGoal } from "../../session/goal.js"
import { SessionInbox } from "../../session/inbox.js"
import { SessionMessage } from "../../session/message.js"
import { SessionPlan } from "../../session/plan.js"
import { SessionTaskFacts } from "../../session/task-facts.js"
import { SessionTodoStore } from "../../session/todo-store.js"
import { SessionEvidence } from "../session-evidence.js"

export const Plugin = {
  id: "redcode.tool.plan-exit",
  effect: Effect.fn("PlanExitTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const db = (yield* Database.Service).db
    const facts = yield* SessionTaskFacts.Service
    const forms = yield* Form.Service
    const goals = yield* SessionGoal.Service
    const intelligence = yield* Intelligence.Service
    const permission = yield* Permission.Service
    const plans = yield* SessionPlan.Service
    const sessions = yield* Session.Service
    const todos = yield* SessionTodoStore.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: "plan_exit",
          options: { codemode: false },
          description:
            "Record the finished plan and request approval to execute it in Build. Supply the complete plan as content, or its path when it was written to a file. For implementation, supply tasks covering every deliverable and verification, each with key, content, criterion and an exact quote from the plan. A Plan-only goal records a ready revision and stays in Plan. System One review is advisory and visible with the approval question. The approved revision and tasks survive compaction.",
          input: Schema.Struct({
            content: Schema.optionalKey(Schema.String),
            path: Schema.optionalKey(Schema.String),
            tasks: Schema.optionalKey(Schema.Array(SessionTodo.PlanTask)),
          }),
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (Boolean(input.content) === Boolean(input.path))
                return yield* new ToolFailure({ message: "Provide exactly one of content or path" })
              yield* permission.assert({
                action: "plan_exit",
                resources: [input.path ?? "*"],
                save: [input.path ?? "*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const source = input.path
                ? yield* SessionEvidence.read(input.path, context, access)
                : {
                    path: "session plan",
                    content: input.content!,
                    hash: SessionEvidence.hash(input.content!),
                  }
              const previous = (yield* plans.list(context.sessionID)).find((item) => item.revision === source.hash)
              const tasks = input.tasks ?? previous?.tasks
              const problem = SessionPlan.validationError({ content: source.content, tasks })
              if (problem) return yield* new ToolFailure({ message: problem })
              const originalRequests = (yield* facts.load(context.sessionID)).requests
              const requests = originalRequests.filter((request) => !request.pending)
              const settings = yield* intelligence.read()
              const evaluation = yield* intelligence
                .evaluate({
                  sessionID: context.sessionID,
                  operation: "plan",
                  candidateID: source.hash,
                  ...SessionPlan.review({ requests, content: source.content, path: source.path, tasks }),
                })
                .pipe(Effect.orElseSucceed(() => undefined))
              const review = SessionPlan.verdict(
                settings,
                evaluation,
                evaluation
                  ? yield* intelligence.history(context.sessionID, { operation: "plan", limit: 20 }).pipe(Effect.orElseSucceed(() => []))
                  : [],
              )
              const current = input.path
                ? yield* SessionEvidence.read(input.path, context, access)
                : source
              if (
                current.hash !== source.hash ||
                IntelligenceEvaluation.fingerprint(requests) !==
                  IntelligenceEvaluation.fingerprint(
                    (yield* facts.load(context.sessionID)).requests.filter((request) => !request.pending),
                  )
              )
                return yield* new ToolFailure({ message: "Plan or user requests changed during review; retry" })
              const goal = yield* goals.get(context.sessionID)
              const ready = yield* plans.record({
                sessionID: context.sessionID,
                revision: source.hash,
                path: source.path,
                content: source.content,
                tasks,
                status: "ready",
                created: Date.now(),
              })
              if (goal?.status === "active" && goal.stopAfter === "plan") {
                const output = `Plan revision ${ready.revision} is ready for review. ${review}`
                return { output, content: output, metadata: { agent: "plan", revision: ready.revision, review } }
              }
              if (!ready.tasks?.length)
                return yield* new ToolFailure({
                  message: "Before Build, supply tasks for every plan deliverable and verification with key, content, criterion and exact quote.",
                })
              if (!goal?.executePlan && previous?.status !== "approved") {
                const answer = yield* forms.ask({
                  sessionID: context.sessionID,
                  title: "Plan approval",
                  metadata: { kind: "question", tool: { messageID: context.messageID, id: context.id } },
                  fields: [
                    {
                      key: "choice",
                      title: "Execute this plan?",
                      description: `${source.path}, revision ${source.hash}\n\n${source.content}\n\nExecution tasks:\n${ready.tasks.map((task) => `- ${task.key}: ${task.content} — ${task.criterion}`).join("\n")}\n\n${review}`,
                      type: "string",
                      options: [
                        { value: "Execute", label: "Execute", description: "Approve this revision and continue in Build" },
                        { value: "Refine", label: "Refine", description: "Stay in Plan" },
                      ],
                      custom: false,
                    },
                  ],
                })
                if (answer.status !== "answered" || answer.answer.choice !== "Execute") {
                  const output = `Plan revision ${ready.revision} remains ready. ${review}`
                  return { output, content: output, metadata: { agent: "plan", revision: ready.revision, review } }
                }
              }
              const latestGoal = yield* goals.get(context.sessionID)
              if (latestGoal?.id !== goal?.id || latestGoal?.revision !== goal?.revision)
                return yield* new ToolFailure({ message: "Goal changed during plan approval; review the current scope" })
              if (input.path && (yield* SessionEvidence.read(input.path, context, access)).hash !== source.hash)
                return yield* new ToolFailure({ message: "Plan changed during approval; review the current revision" })
              const admitted = yield* todos.write(
                {
                  sessionID: context.sessionID,
                  origin: { type: "plan", id: ready.revision, quote: ready.content, created: ready.created },
                  todos: ready.tasks.map((task) => ({
                    planKey: task.key,
                    content: task.content,
                    criterion: task.criterion,
                    requirement: task.quote,
                    status: "pending",
                    priority: "high",
                  })),
                  messageID: context.messageID,
                },
                {
                  before: Effect.gen(function* () {
                    if (input.path && (yield* SessionEvidence.read(input.path, context, access)).hash !== source.hash)
                      return yield* new SessionTodo.Error({ message: "Plan changed while admitting tasks" })
                  }).pipe(Effect.mapError((error) => new SessionTodo.Error({ message: error.message }))),
                  write: plans
                    .record(
                      { ...ready, status: "approved", created: Date.now() },
                      Effect.gen(function* () {
                        const currentGoal = yield* goals.get(context.sessionID)
                        const steer = yield* SessionInbox.has(db, context.sessionID, "steer")
                        return (
                          currentGoal?.id === goal?.id &&
                          currentGoal?.revision === goal?.revision &&
                          IntelligenceEvaluation.fingerprint(originalRequests) ===
                            IntelligenceEvaluation.fingerprint((yield* facts.load(context.sessionID)).requests) &&
                          !steer
                        )
                      }).pipe(Effect.mapError((error) => new SessionPlan.Error({ message: error.message }))),
                    )
                    .pipe(Effect.asVoid, Effect.mapError((error) => new SessionTodo.Error({ message: error.message }))),
                },
              )
              return yield* SessionInbox.serialized(
                context.sessionID,
                Effect.gen(function* () {
                  if (yield* SessionInbox.has(db, context.sessionID, "steer")) {
                    const output = `Plan revision ${ready.revision} approved with ${admitted.todos.length} tasks. New user input is pending; address it before Build. ${review}`
                    return { output, content: output, metadata: { agent: "plan", revision: ready.revision, review } }
                  }
                  yield* sessions.synthetic({
                    sessionID: context.sessionID,
                    id: SessionMessage.ID.make(
                      `msg_plan_approval_${SessionEvidence.hash(`${context.sessionID}:${source.hash}`).slice(0, 32)}`,
                    ),
                    text: `Execute approved plan revision ${source.hash}. Its full content and tasks are supplied in system context. Preserve its scope and verification criteria.`,
                    metadata: { source: "plan.approval", revision: source.hash },
                    resume: false,
                  })
                  yield* sessions.switchAgent({ sessionID: context.sessionID, agent: Agent.ID.make("build") })
                  const output = `Plan revision ${ready.revision} approved. Continue in Build. ${review}${admitted.notes.length ? `\n${admitted.notes.join("\n")}` : ""}`
                  return { output, content: output, metadata: { agent: "build", revision: ready.revision, review } }
                }),
              ).pipe(Effect.uninterruptible)
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
