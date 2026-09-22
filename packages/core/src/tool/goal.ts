export * as GoalTools from "./goal"

import { ToolFailure } from "@reddb-io/redcode-llm"
import { Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { AppProcess } from "../process"
import { SessionGoal } from "../session/goal"
import { SessionGoalCompletion } from "../session/goal-completion"
import { ToolRegistry } from "./registry"
import { Tools } from "./tools"
import { Tool } from "./tool"
import { SessionEvidence } from "./session-evidence"
import { Intelligence } from "../intelligence"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const goals = yield* SessionGoal.Service
    const completion = yield* SessionGoalCompletion.Service
    const permissions = yield* PermissionV2.Service
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service
    const intelligence = yield* Intelligence.Service
    const allow = (action: string, context: Tool.Context, resources = ["*"]) =>
      permissions.assert({
        action,
        resources,
        save: resources,
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool" as const, messageID: context.assistantMessageID, callID: context.toolCallID },
      })
    yield* tools
      .register({
        goal_status: Tool.make({
          description:
            "Inspect the active goal or report a genuine blocker. Blocking preserves the objective and stops automatic continuation until the user resumes. Do not use blocked for ordinary remaining work.",
          input: Schema.Struct({ reason: Schema.String.pipe(Schema.optional) }),
          output: Schema.NullOr(SessionGoal.Info),
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("goal_status", context)
              const goal = yield* goals.get(context.sessionID)
              if (!goal || !input.reason || (goal.status !== "active" && goal.status !== "waiting")) return goal
              return yield* goals.save(goal, { ...goal, status: "blocked", reason: input.reason })
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message }))),
        }),
        goal_complete: Tool.make({
          description:
            "Verify completion against the original goal. Supply 1–8 actual evidence files (source, test report, plan, approval or audit), each at most 128 KB. The harness reads them, checks running work, executes user-configured gates, asks an independent reviewer to assess every criterion, and rejects stale evidence. A claim alone never completes a goal.",
          input: Schema.Struct({
            evidence: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
            explanation: Schema.String,
          }),
          output: SessionGoal.Info,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("goal_complete", context)
              const goal = yield* goals.get(context.sessionID)
              if (!goal || goal.status !== "active")
                return yield* new ToolFailure({ message: "No active goal to complete" })
              yield* Intelligence.requireConfigured(yield* intelligence.read())
              yield* completion.check(context.sessionID)
              const evidence = yield* Effect.forEach([...new Set(input.evidence)], (file) =>
                SessionEvidence.read(file, context, permissions, location),
              )
              const checks: SessionGoal.Info["checks"][number][] = []
              for (const command of goal.gates) {
                yield* allow("bash", context, [command])
                const result = yield* processes.run(
                  ChildProcess.make(
                    process.platform === "win32" ? "cmd.exe" : "/bin/sh",
                    [process.platform === "win32" ? "/c" : "-c", command],
                    { cwd: location.directory },
                  ),
                  { timeout: "60 seconds", maxOutputBytes: 16000, maxErrorBytes: 16000 },
                )
                checks.push({
                  command,
                  exitCode: result.exitCode,
                  output: `${result.stdout.toString()}\n${result.stderr.toString()}`,
                  at: Date.now(),
                })
                if (result.exitCode !== 0)
                  return yield* new ToolFailure({
                    message: `Goal check failed: ${command} (exit ${result.exitCode})\n${checks.at(-1)?.output}`,
                  })
              }
              const review = yield* Effect.uninterruptibleMask((restore) =>
                restore(
                  intelligence.evaluate({
                    sessionID: context.sessionID,
                    operation: "goal_completion",
                    subjectID: goal.id,
                    sources: {
                      objective: goal.objective,
                      scope: goal.stopAfter,
                      criteria: goal.criteria,
                      checks: checks.map((check) => ({
                        ...check,
                        output: Intelligence.evidence(check.output, { reference: check.command, limit: 4000 }),
                      })),
                      evidence: evidence.map((item) => ({
                        ...item,
                        content: Intelligence.evidence(item.content, {
                          reference: item.path,
                          limit: Math.floor(36000 / evidence.length),
                        }),
                      })),
                    },
                    candidate: { claim: input.explanation, status: "done" },
                    questions: Intelligence.questions({
                      objective:
                        "Does candidate claim completion without relevant observed evidence proving the objective within the requested scope? A source file or unexecuted test is not proof of runtime behavior.",
                      incomplete:
                        "Does the claim depend on missing or truncated evidence? Omitted evidence must not be assumed successful.",
                      ...Object.fromEntries(
                        goal.criteria.map((criterion, index) => [
                          `criterion_${index}`,
                          `Is this required criterion unsupported by the recorded artifacts and executed checks: ${criterion}`,
                        ]),
                      ),
                    }),
                  }),
                ).pipe(
                  Effect.tap((review) =>
                    review
                      ? goals.recordReview(goal, {
                          id: review.id,
                          tokens: review.usage.input_tokens + review.usage.output_tokens,
                        })
                      : Effect.void,
                  ),
                ),
              )
              const current = yield* Effect.forEach(evidence, (item) =>
                SessionEvidence.read(item.path, context, permissions, location),
              )
              if (current.some((item, index) => item.hash !== evidence[index].hash))
                return yield* new ToolFailure({
                  message: "Evidence changed during verification. Verify the current files again.",
                })
              yield* Intelligence.requireConfigured(yield* intelligence.read())
              const passed = review?.decision === "accepted"
              // Work admitted while the reviewer ran invalidates its completion verdict.
              yield* completion.check(context.sessionID)
              if (passed) return yield* completion.propose({ goal, context, evidence: current, checks })
              return yield* goals.save(goal, {
                ...goal,
                status: "active",
                reason: `System One evaluation ${review?.decision ?? "unavailable"}: ${review?.issues.join(", ") ?? "No evaluation"}. Previous goal status preserved.`,
                checks,
                evidence: current.map((item) => ({ path: item.path, hash: item.hash, bytes: item.bytes })),
              })
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/goal",
  layer,
  deps: [
    ToolRegistry.toolsNode,
    SessionGoal.node,
    SessionGoalCompletion.node,
    PermissionV2.node,
    Location.node,
    AppProcess.node,
    Intelligence.node,
  ],
})
