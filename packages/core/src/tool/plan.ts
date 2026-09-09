export * as PlanTools from "./plan"

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
            "Read and record the finished implementation plan. Provide its file path. The plan must be self-contained, name decisions and include concrete verification. A Plan-only goal records the ready revision and stays in Plan. Otherwise execution requires existing explicit authorization or the user's approval of this revision. The approved content is preserved across compaction and resume.",
          input: Schema.Struct({ path: Schema.String }),
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
              const evidence = yield* SessionEvidence.read(input.path, context, permissions, location)
              const savedGoal = yield* goals.get(context.sessionID)
              const goal = savedGoal?.status === "active" || savedGoal?.status === "waiting" ? savedGoal : null
              const previous = (yield* plans.list(context.sessionID)).find((plan) => plan.revision === evidence.hash)
              const ready = yield* plans.record({
                sessionID: context.sessionID,
                revision: evidence.hash,
                path: evidence.path,
                content: evidence.content,
                status: "ready",
                created: Date.now(),
              })
              if (goal && goal.stopAfter !== "build") return ready
              if (!goal?.executePlan && previous?.status !== "approved") {
                const answer = yield* questions.ask({
                  sessionID: context.sessionID,
                  tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                  questions: [
                    {
                      header: "Plan approval",
                      question: `Execute this recorded plan? ${evidence.path}\nRevision ${evidence.hash}\n\n${evidence.content}`,
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
              const approved = yield* plans.record({ ...ready, status: "approved", created: Date.now() })
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
                text: `Execute approved plan revision ${approved.revision}. The recorded plan content is in your system context. Preserve its scope and verify the stated criteria.`,
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
  ],
})
