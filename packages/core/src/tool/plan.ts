import { Semantic } from "../semantic"
import { Intelligence } from "../intelligence"
import { SessionTaskFacts } from "../session/task-facts"
export * as PlanTools from "./plan"

import { SessionTodo } from "../session/todo"
import { Database } from "../database/database"
import { SessionInput } from "../session/input"

import { ToolFailure } from "@reddb-io/redcode-llm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { QuestionV2 } from "../question"
import { SessionGoal } from "../session/goal"
import { SessionPlan } from "../session/plan"
import { SessionEvent } from "../session/event"
import { SessionMessage } from "../session/message"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { SessionEvidence } from "./session-evidence"
import { RepositoryGuard } from "../repository-guard"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permissions = yield* PermissionV2.Service
    const questions = yield* QuestionV2.Service
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const plans = yield* SessionPlan.Service
    const goals = yield* SessionGoal.Service
    const todos = yield* SessionTodo.Service
    const semantic = yield* Semantic.Service
    const intelligence = yield* Intelligence.Service
    const facts = yield* SessionTaskFacts.Service
    const database = yield* Database.Service
    yield* tools
      .register({
        worktree_prepare: Tool.make({
          description:
            "Run the mandatory repository preflight before coding. Create or reuse this session's linked worktree, return its absolute paths and Git status, and preserve the source checkout. Non-Git directories and YOLO mode keep their directory.",
          input: Schema.Struct({}),
          output: Schema.String,
          execute: (_input, context) =>
            Effect.gen(function* () {
              yield* permissions.assert({
                action: "worktree_prepare",
                resources: [location.directory],
                save: [location.directory],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              return yield* Effect.tryPromise({
                try: () => RepositoryGuard.preflight(location.directory, context.sessionID),
                catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) }),
              })
            }).pipe(
              Effect.mapError(
                (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) }),
              ),
            ),
        }),
        plan_exit: Tool.make({
          description:
            "Read and record the finished implementation plan. Provide its file path and tasks covering every deliverable and verification, each with key, content, criterion and exact quote from the plan. Build requires this decomposition, which creates persistent tasks after approval. The plan must be self-contained, name decisions and include concrete verification. When the plan implements an approved Design that changes existing code, include tasks that verify the behaviors it preserves (for example data loading, pagination and state), not only the visual changes. A Plan-only goal records the ready revision and stays in Plan. Otherwise execution requires existing explicit authorization or the user's approval of this revision. The approved content is preserved across compaction and resume.",
          input: Schema.Struct({ path: Schema.String, tasks: Schema.optional(Schema.Array(SessionTodo.PlanTask)) }),
          output: SessionPlan.Info,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permissions.assert({
                action: "plan_exit",
                resources: [input.path],
                save: [input.path],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              yield* Intelligence.requireConfigured(yield* intelligence.read())
              const evidence = yield* SessionEvidence.read(input.path, context, permissions, location)
              const savedGoal = yield* goals.get(context.sessionID)
              const goal = savedGoal?.status === "active" || savedGoal?.status === "waiting" ? savedGoal : null
              const previous = (yield* plans.list(context.sessionID)).find((plan) => plan.revision === evidence.hash)
              const sourceRequests = (yield* facts.load(context.sessionID)).requests
              const requests = sourceRequests.filter((request) => !request.pending)
              const decomposition =
                input.tasks ??
                previous?.tasks ??
                (yield* semantic.transform({
                  sessionID: context.sessionID,
                  operation: "plan",
                  sources: { requests, plan: evidence.content },
                  prompt: `Extract tasks from this implementation plan. Return only a JSON array of {key,content,criterion,quote}; quote must occur verbatim in the plan. Cover every deliverable and verification. Plan: ${evidence.content}`,
                  decode: (text) =>
                    Semantic.json(Schema.Array(SessionTodo.PlanTask).check(Schema.isMinLength(1)))(text).pipe(
                      Effect.flatMap((tasks) => {
                        const problem = SessionPlan.validationError({ content: evidence.content, tasks })
                        return problem
                          ? Effect.fail(new Intelligence.Error({ message: problem }))
                          : Effect.succeed(tasks)
                      }),
                    ),
                  checks: () =>
                    Intelligence.questions({
                      coverage: "Does candidate omit a deliverable or verification stated in sources.plan?",
                      fidelity: "Does candidate contradict or add scope unrelated to sources.plan?",
                    }),
                }))
              const problem = SessionPlan.validationError({ content: evidence.content, tasks: decomposition })
              if (problem) return yield* new ToolFailure({ message: problem })
              const evaluation = yield* intelligence.evaluate({
                sessionID: context.sessionID,
                operation: "plan",
                sources: {
                  requests: Intelligence.evidence(requests, { reference: context.sessionID, limit: 24000 }),
                  coverage:
                    "All applicable request text must be visible to approve the plan; truncated history is incomplete coverage.",
                },
                candidate: {
                  plan: Intelligence.evidence(evidence.content, { reference: evidence.path, limit: 24000 }),
                  tasks: decomposition,
                },
                questions: Intelligence.questions({
                  coverage:
                    "Are sources.requests or candidate.plan truncated, so full requirements or plan coverage cannot be verified? Missing content cannot be assumed covered.",
                  decomposition:
                    "Do candidate.tasks omit a deliverable or verification from candidate.plan, contradict that plan, or lack observable acceptance criteria? If tasks are absent, evaluate only the plan itself.",
                  requirements:
                    "Does candidate.plan omit or contradict an applicable requirement in sources.requests, accounting for later corrections?",
                }),
              })
              yield* Intelligence.requireAccepted(evaluation)
              const currentEvidence = yield* SessionEvidence.read(input.path, context, permissions, location)
              if (
                currentEvidence.hash !== evidence.hash ||
                Intelligence.fingerprint(requests) !==
                  Intelligence.fingerprint(
                    (yield* facts.load(context.sessionID)).requests.filter((request) => !request.pending),
                  )
              )
                return yield* new ToolFailure({ message: "Plan sources changed during evaluation; retry" })
              yield* Intelligence.requireConfigured(yield* intelligence.read())
              const ready = yield* plans.record({
                sessionID: context.sessionID,
                revision: evidence.hash,
                path: evidence.path,
                content: evidence.content,
                tasks: decomposition,
                status: "ready",
                created: Date.now(),
              })
              if (goal && goal.stopAfter !== "build") return ready
              if (!ready.tasks?.length)
                return yield* new ToolFailure({
                  message:
                    "Before Build, call plan_exit with tasks covering every plan deliverable, including verification. Each needs key, content, criterion and an exact quote from the plan.",
                })
              if (!goal?.executePlan && !(previous?.status === "approved" && previous.tasks?.length)) {
                const answer = yield* questions.ask({
                  sessionID: context.sessionID,
                  tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                  questions: [
                    {
                      header: "Plan approval",
                      question: `Execute this recorded plan? ${evidence.path}\nRevision ${evidence.hash}\n\n${evidence.content}\n\nExecution tasks:\n${ready.tasks.map((task) => `- ${task.key}: ${task.content} — ${task.criterion}`).join("\n")}`,
                      custom: false,
                      options: [
                        { label: "Execute", description: "Approve this revision and start Build" },
                        { label: "Refine", description: "Stay in Plan" },
                      ],
                    },
                  ],
                })
                if (answer[0]?.[0] !== "Execute") return ready
              }
              const current = yield* SessionEvidence.read(input.path, context, permissions, location)
              if (current.hash !== evidence.hash)
                return yield* new ToolFailure({
                  message: "Plan changed during review. Review the new revision before executing.",
                })
              const latest = yield* goals.get(context.sessionID)
              if (latest?.id !== savedGoal?.id || latest?.revision !== savedGoal?.revision)
                return yield* new ToolFailure({
                  message: "Goal changed during plan approval. Inspect the current goal before executing.",
                })
              yield* Intelligence.requireConfigured(yield* intelligence.read())
              const approved = { ...ready, status: "approved" as const, created: Date.now() }
              yield* todos.update(
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
                },
                {
                  before: Effect.gen(function* () {
                    if (
                      (yield* SessionEvidence.read(input.path, context, permissions, location)).hash !== evidence.hash
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
                        const currentGoal = yield* goals.get(context.sessionID)
                        return (
                          currentGoal?.id === savedGoal?.id &&
                          currentGoal?.revision === savedGoal?.revision &&
                          Intelligence.fingerprint(sourceRequests) ===
                            Intelligence.fingerprint((yield* facts.load(context.sessionID)).requests) &&
                          !(yield* SessionInput.hasPending(database.db, context.sessionID, "steer"))
                        )
                      }).pipe(Effect.mapError((error) => new SessionPlan.Error({ message: error.message }))),
                    )
                    .pipe(
                      Effect.asVoid,
                      Effect.mapError((error) => new SessionTodo.Error({ message: error.message })),
                    ),
                },
              )
              yield* events.publish(SessionEvent.AgentSwitched, {
                sessionID: context.sessionID,
                messageID: SessionMessage.ID.create(),
                timestamp: yield* DateTime.now,
                agent: "build",
              })
              yield* events.publish(SessionEvent.Synthetic, {
                sessionID: context.sessionID,
                messageID: SessionMessage.ID.create(),
                timestamp: yield* DateTime.now,
                text: `Execute approved plan revision ${approved.revision}. The recorded plan content is in your system context. Preserve its scope and verify the stated criteria. If the plan implements an approved Design, follow its implementation contract.`,
              })
              return approved
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/plan",
  layer,
  deps: [
    ToolRegistry.toolsNode,
    PermissionV2.node,
    QuestionV2.node,
    EventV2.node,
    Location.node,
    SessionPlan.node,
    SessionGoal.node,
    SessionTodo.node,
    Semantic.node,
    Intelligence.node,
    SessionTaskFacts.node,
    Database.node,
  ],
})
