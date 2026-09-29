export * as ConfigSession from "./session.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "../schema.js"

const Positive = Schema.Finite.check(Schema.isGreaterThan(0))

export const Budget = Schema.Struct({
  max_cost_usd: Positive.pipe(optional).annotate({
    description:
      "Stop a turn after the step that brings the session's spend, including subagents, to this many US dollars",
  }),
  max_tokens: PositiveInt.pipe(optional).annotate({
    description: "Stop a turn after the step that brings the session's tokens, including subagents, to this count",
  }),
}).annotate({ identifier: "Config.SessionBudget" })
export interface Budget extends Schema.Schema.Type<typeof Budget> {}

export const Info = Schema.Struct({
  budget: Budget.pipe(optional).annotate({
    description:
      "Spend limits for sessions without their own budget; nothing is limited unless set here, per session, or by `redcode run --max-cost/--max-tokens`",
  }),
}).annotate({ identifier: "Config.Session" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
