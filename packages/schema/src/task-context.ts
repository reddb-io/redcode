export * as TaskContext from "./task-context.js"

import { Schema } from "effect"
import { SessionGoal } from "./session-goal.js"

/** The shared objective actually delivered to a child, independent of execution accounting. */
export const Info = Schema.Struct({
  version: Schema.String,
  goal: Schema.Struct({
    id: SessionGoal.Info.fields.id,
    objective: SessionGoal.Info.fields.objective,
    criteria: SessionGoal.Info.fields.criteria,
    gates: SessionGoal.Info.fields.gates,
    stopAfter: SessionGoal.Info.fields.stopAfter,
    executePlan: SessionGoal.Info.fields.executePlan,
  }),
}).annotate({ identifier: "TaskContext.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
