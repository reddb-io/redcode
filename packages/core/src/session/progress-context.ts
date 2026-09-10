export * as SessionProgressContext from "./progress-context"

import { Effect, Schema } from "effect"
import { SystemContext } from "../system-context/index"
import { SessionSchema } from "./schema"
import { SessionTodo } from "./todo"
import { SessionGoal } from "./goal"
import { SessionPlan } from "./plan"

export const load = Effect.fn(function* (sessionID: SessionSchema.ID) {
  const todos = yield* SessionTodo.Service
  const tasks = yield* todos.review(sessionID).pipe(Effect.orDie)
  const goals = yield* SessionGoal.Service
  const plans = yield* SessionPlan.Service
  const goal = yield* goals.get(sessionID).pipe(Effect.orDie)
  const plan = SessionPlan.guidance(yield* plans.list(sessionID))
  // Budget/usage changes must not resend the entire approved plan on every provider turn.
  return SystemContext.combine([
    ...(tasks.length
      ? [
          SystemContext.make({
            key: SystemContext.Key.make("session/tasks"),
            codec: Schema.toCodecJson(Schema.Array(SessionTodo.Info)),
            load: Effect.succeed(tasks),
            baseline: SessionTodo.context,
            update: (_previous, current) => SessionTodo.context(current),
            removed: () => "Task state removed; inspect current work before continuing.",
          }),
        ]
      : []),
    ...(goal
      ? [
          SystemContext.make({
            key: SystemContext.Key.make("session/goal"),
            codec: Schema.toCodecJson(SessionGoal.Info),
            load: Effect.succeed(goal),
            baseline: SessionGoal.guidance,
            update: (previous, current) =>
              previous.id !== current.id
                ? SessionGoal.guidance(current)
                : `Goal ${current.id}: ${current.status}. ${current.reason}\nProvider turns: ${current.turns.used}/${current.turns.max}. Continue within the recorded objective, criteria and scope; budget exhaustion is not completion.`,
            removed: () => "The previous Goal is no longer active. Follow the current user request.",
          }),
        ]
      : []),
    ...(plan
      ? [
          SystemContext.make({
            key: SystemContext.Key.make("session/plan"),
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.succeed(plan),
            baseline: (text) => text,
            update: (_previous, text) => text,
            removed: () => "The previous recorded Plan context has been removed.",
          }),
        ]
      : []),
  ])
})
