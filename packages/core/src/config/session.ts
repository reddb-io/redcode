export * as ConfigSession from "./session"

import { Schema } from "effect"

const Positive = Schema.Number.check(Schema.isGreaterThan(0))

export class Budget extends Schema.Class<Budget>("ConfigV2.SessionBudget")({
  max_cost_usd: Positive.pipe(Schema.optional).annotate({
    description:
      "Dollars one top-level session may spend on providers, its subagents, compaction, titles and goal judging included. No default: nothing is limited unless set.",
  }),
  max_tokens: Positive.pipe(Schema.optional).annotate({
    description:
      "Tokens one top-level session may spend: input, output, reasoning and cache, every call counted. Applies even when a model has no pricing. No default.",
  }),
  reset_on_message: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "When a budget is reached the turn stops after its current step and no provider is called until the budget is raised (default: false). Set to true to count the budget afresh from each message a person sends; goal continuations never reset it.",
  }),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Session")({
  budget: Budget.pipe(Schema.optional).annotate({
    description: "A spend limit for each session; override one session with /budget or --max-cost",
  }),
}) {}
