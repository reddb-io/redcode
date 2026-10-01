import { describe, expect, test } from "bun:test"
import { SessionBudget } from "@opencode/core/session/budget"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { IntelligenceEvaluationTable } from "@opencode/core/intelligence/sql"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionTable } from "@opencode/core/session/sql"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionBudget.node])))

describe("SessionBudget", () => {
  test("reads configured limits and ignores an absent or empty budget", () => {
    expect(SessionBudget.configured({ max_cost_usd: 2.5, max_tokens: 500_000 })).toEqual({
      maxCostUsd: 2.5,
      maxTokens: 500_000,
    })
    expect(SessionBudget.configured({ max_tokens: 1_000 })).toEqual({ maxTokens: 1_000 })
    expect(SessionBudget.configured(undefined)).toEqual({})
    expect(SessionBudget.hasLimits(SessionBudget.configured({}))).toBe(false)
  })

  test("a configured limit stops once spend reaches it", () => {
    const limits = SessionBudget.configured({ max_cost_usd: 1 })
    expect(SessionBudget.check(limits, { cost: 0.5, tokens: 10, unpriced: 0 }).exceeded).toBe(false)
    expect(SessionBudget.check(limits, { cost: 1, tokens: 10, unpriced: 0 })).toMatchObject({
      exceeded: true,
      reason: "$1.00 of $1.00 spent",
    })
  })

  it.effect("includes persisted S1 usage across descendants without duplicating S2 totals", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const budgets = yield* SessionBudget.Service
      const projectID = Project.ID.make("budget-project")
      const root = Session.ID.make("ses_budget_root")
      const child = Session.ID.make("ses_budget_child")
      const grandchild = Session.ID.make("ses_budget_grandchild")
      const other = Session.ID.make("ses_budget_other")
      yield* db.insert(ProjectTable).values({ id: projectID, worktree: AbsolutePath.make("/budget"), sandboxes: [] })
      yield* db.insert(SessionTable).values([
        {
          id: root,
          project_id: projectID,
          slug: "root",
          directory: "/budget",
          version: "test",
          tokens_input: 628,
          tokens_output: 5,
          cost: 1.5,
        },
        {
          id: child,
          parent_id: root,
          project_id: projectID,
          slug: "child",
          directory: "/budget",
          version: "test",
          tokens_input: 50,
          cost: 0.2,
        },
        {
          id: grandchild,
          parent_id: child,
          project_id: projectID,
          slug: "grandchild",
          directory: "/budget",
          version: "test",
          tokens_input: 20,
          cost: 0.3,
        },
        {
          id: other,
          project_id: projectID,
          slug: "other",
          directory: "/budget",
          version: "test",
          tokens_input: 100_000,
          cost: 100,
        },
      ])
      const start = yield* budgets.totals(root)
      expect(start).toEqual({ cost: 2, tokens: 703, unpriced: 0 })
      yield* db.insert(IntelligenceEvaluationTable).values(
        [
          { id: "classification", session_id: root, input_tokens: 3992, output_tokens: 446 },
          { id: "review", session_id: root, input_tokens: 1026, output_tokens: 21 },
          { id: "child-review", session_id: child, input_tokens: 100, output_tokens: 10 },
          { id: "grandchild-review", session_id: grandchild, input_tokens: 200, output_tokens: 20 },
          { id: "unavailable", session_id: root, input_tokens: 0, output_tokens: 0 },
          { id: "other-review", session_id: other, input_tokens: 100_000, output_tokens: 100_000 },
        ].map((row) => ({
          ...row,
          operation: "response_quality",
          evaluation_kind: "gate",
          fingerprint: row.id,
          policy: "test",
          decision: row.id === "unavailable" ? "unavailable" : "accepted",
          model: "jev",
          issues: [],
          duration: 1,
          source_hash: "source",
          candidate_hash: "candidate",
          time_created: 1,
        })),
      )
      const spent = yield* budgets.totals(root)
      expect(spent).toEqual({ cost: 2, tokens: 6518, unpriced: 4 })
      expect(yield* budgets.totals(root)).toEqual(spent)
      expect(yield* budgets.totals(child)).toEqual({ cost: 0.5, tokens: 400, unpriced: 2 })
      expect(SessionBudget.since(spent, start)).toEqual({ cost: 0, tokens: 5815, unpriced: 4 })
      expect(SessionBudget.check({ maxTokens: 1_000 }, spent).exceeded).toBe(true)
      expect(SessionBudget.check({ maxCostUsd: 10 }, spent)).toMatchObject({ exceeded: false, unknown: true })
      expect((yield* budgets.view(root)).spent).toEqual(spent)
      expect(yield* budgets.admit(root, { maxTokens: 1_000 })).toBe(false)
      expect(yield* budgets.admit(child, { maxTokens: 1_000 })).toBe(false)
      expect(yield* budgets.totals(Session.ID.make("ses_missing"))).toEqual(SessionBudget.ZERO)
    }),
  )
})
