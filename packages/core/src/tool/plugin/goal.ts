export * as GoalTool from "./goal.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { AppProcess } from "@opencode/util/process"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { FileAccess } from "../../file-access.js"
import { Intelligence } from "../../intelligence.js"
import { IntelligenceEvaluation } from "../../intelligence/evaluation.js"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"
import { SessionGoal } from "../../session/goal.js"
import { SessionGoalCompletion } from "../../session/goal-completion.js"
import { SessionEvidence } from "../session-evidence.js"
import type { Tool } from "../../tool.js"

export const Plugin = {
  id: "opencode.tool.goal",
  effect: Effect.fn("GoalTool.Plugin")(function* (ctx: Context) {
    const goals = yield* SessionGoal.Service
    const completion = yield* SessionGoalCompletion.Service
    const permission = yield* Permission.Service
    const access = yield* FileAccess.Service
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service
    const intelligence = yield* Intelligence.Service

    const allow = (action: string, context: Tool.Context, resources = ["*"]) =>
      permission.assert({
        action,
        resources,
        save: resources,
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool", messageID: context.messageID, id: context.id },
      })

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "goal_status",
          options: { codemode: false },
          description:
            "Inspect the active goal or report a concrete blocker. Blocking preserves the objective until the user resumes it.",
          input: Schema.Struct({ reason: Schema.optionalKey(Schema.String) }),
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("goal_status", context)
              const goal = yield* goals.get(context.sessionID)
              const current =
                goal && input.reason && (goal.status === "active" || goal.status === "waiting")
                  ? yield* goals.save(goal, { ...goal, status: "blocked", reason: input.reason })
                  : goal
              const output = JSON.stringify(current)
              return { output, content: output, metadata: { status: current?.status ?? "none" } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })
        editor.add({
          name: "goal_complete",
          options: { codemode: false },
          description:
            "Propose completion of the active goal with 1–8 actual evidence files and an explanation. The harness reads them, checks unfinished work, runs configured gates and asks System One to review every criterion when dual reasoning is enabled. Completion is committed only after concurrent tools settle.",
          input: Schema.Struct({
            evidence: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
            explanation: Schema.String,
          }),
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("goal_complete", context)
              const goal = yield* goals.get(context.sessionID)
              if (!goal || goal.status !== "active")
                return yield* new ToolFailure({ message: "No active goal to complete" })
              const settings = yield* intelligence.read()
              yield* IntelligenceEvaluation.requireConfigured(settings)
              yield* completion.check(context.sessionID)
              const evidence = yield* Effect.forEach([...new Set(input.evidence)], (file) =>
                SessionEvidence.read(file, context, access),
              )
              const checks: SessionGoal.Info["checks"][number][] = []
              for (const command of goal.gates) {
                yield* allow("shell", context, [command])
                const result = yield* processes.run(
                  ChildProcess.make(process.platform === "win32" ? "cmd.exe" : "/bin/sh", [
                    process.platform === "win32" ? "/c" : "-c",
                    command,
                  ], { cwd: location.directory }),
                  { timeout: "60 seconds", maxOutputBytes: 16_000, maxErrorBytes: 16_000 },
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
                restore(intelligence.evaluate({
                  sessionID: context.sessionID,
                  operation: "goal_completion",
                  subjectID: goal.id,
                  sources: {
                    objective: goal.objective,
                    scope: goal.stopAfter,
                    criteria: goal.criteria,
                    checks: checks.map((item) => ({
                      ...item,
                      output: IntelligenceEvaluation.evidence(item.output, { reference: item.command, limit: 4_000 }),
                    })),
                    evidence: evidence.map((item) => ({
                      ...item,
                      content: IntelligenceEvaluation.evidence(item.content, {
                        reference: item.path,
                        limit: Math.floor(36_000 / evidence.length),
                      }),
                    })),
                  },
                  candidate: { claim: input.explanation, status: "done" },
                  questions: IntelligenceEvaluation.questions({
                    objective:
                      "Does the candidate claim completion without observed evidence proving the objective? A source file or unexecuted test is not proof of runtime behavior.",
                    incomplete: "Does the claim depend on missing or truncated evidence?",
                    ...Object.fromEntries(
                      goal.criteria.map((criterion, index) => [
                        `criterion_${index}`,
                        `Is this required criterion unsupported by the recorded artifacts and executed checks: ${criterion}`,
                      ]),
                    ),
                  }),
                })).pipe(
                  Effect.tap((record) =>
                    record
                      ? goals.recordReview(goal, {
                          id: record.id,
                          tokens: record.usage.input_tokens + record.usage.output_tokens,
                        })
                      : Effect.void,
                  ),
                ),
              )
              const current = yield* Effect.forEach(evidence, (item) =>
                SessionEvidence.read(item.path, context, access),
              )
              if (current.some((item, index) => item.hash !== evidence[index]?.hash))
                return yield* new ToolFailure({ message: "Evidence changed during verification" })
              yield* IntelligenceEvaluation.requireConfigured(yield* intelligence.read())
              yield* completion.check(context.sessionID)
              const passed = IntelligenceEvaluation.mode(settings) === "single" || review?.decision === "accepted"
              const result = passed
                ? yield* completion.propose({ goal, context, evidence: current, checks })
                : yield* goals.save(goal, {
                    ...goal,
                    status: "active",
                    reason: `System One evaluation ${review?.decision ?? "unavailable"}: ${review?.issues.join(", ") ?? "No evaluation"}. Previous goal status preserved.`,
                    checks,
                    evidence: current.map((item) => ({ path: item.path, hash: item.hash, bytes: item.bytes })),
                  })
              const output = JSON.stringify(result)
              return { output, content: output, metadata: { status: result.status } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })
      })
      .pipe(Effect.orDie)
  }),
}
