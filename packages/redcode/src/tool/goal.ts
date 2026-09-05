import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./goal-complete.txt"
import { GoalRuntime } from "@/session/goal-runtime"

export const Parameters = Schema.Struct({
  evidence: Schema.String.annotate({
    description:
      "Direct, current-state evidence for every deliverable in the goal: file contents, command output, test results, ids or URLs that exist now. Quoted, not summarised.",
  }),
})

/**
 * The agent's side of "done". It never ends the loop by itself: it records a claim, and the
 * judge reads the claim against the goal at the end of the turn. What it buys is that a
 * completion is argued from evidence rather than announced.
 */
export const GoalCompleteTool = Tool.define(
  "goal_complete",
  Effect.gen(function* () {
    const goals = yield* GoalRuntime.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: typeof Parameters.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const goal = yield* goals.get(ctx.sessionID)
          if (!goal || goal.status !== "active") {
            return {
              title: "No active goal",
              output: "There is no active goal in this session. Nothing was recorded.",
              metadata: { goal: undefined as string | undefined },
            }
          }
          yield* goals.claim(ctx.sessionID, params.evidence.trim())
          return {
            title: "Completion claimed",
            output:
              "Claim recorded. The judge reads it against the goal when this turn ends; if the evidence does not cover every deliverable, the goal continues.",
            metadata: { goal: goal.id as string | undefined },
          }
        }),
    }
  }),
)

export * as GoalComplete from "./goal"
