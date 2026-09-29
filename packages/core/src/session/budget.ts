export * as SessionBudget from "./budget.js"
export { Limits, Totals, View, Update } from "@opencode/schema/session-budget"

import { SessionBudget } from "@opencode/schema/session-budget"
import type { ConfigSession } from "@opencode/schema/config/session"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { SessionEvent } from "./event.js"
import { SessionGuardLog } from "./guard-log.js"
import { SessionSchema } from "./schema.js"
import { SessionTable } from "./sql.js"
import { SessionStore } from "./store.js"

export const ZERO: SessionBudget.Totals = { cost: 0, tokens: 0, unpriced: 0 }

const positive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined

export function limitsOf(raw: unknown): SessionBudget.Limits {
  if (!raw || typeof raw !== "object") return {}
  const value = raw as Record<string, unknown>
  const cost = positive(value.maxCostUsd)
  const tokens = positive(value.maxTokens)
  return {
    ...(cost === undefined ? {} : { maxCostUsd: cost }),
    ...(tokens === undefined ? {} : { maxTokens: Math.floor(tokens) }),
  }
}

/** Limits from the `session.budget` configuration, which apply to a session that has no budget of its own. */
export function configured(budget: ConfigSession.Budget | undefined): SessionBudget.Limits {
  return limitsOf({ maxCostUsd: budget?.max_cost_usd, maxTokens: budget?.max_tokens })
}

export const hasLimits = (limits: SessionBudget.Limits | undefined) =>
  limits !== undefined && (limits.maxCostUsd !== undefined || limits.maxTokens !== undefined)

export function update(current: unknown, change: SessionBudget.Update) {
  const limits: { maxCostUsd?: number; maxTokens?: number } = { ...limitsOf(current) }
  if (change.maxCostUsd === null) delete limits.maxCostUsd
  if (change.maxCostUsd !== undefined && change.maxCostUsd !== null) limits.maxCostUsd = change.maxCostUsd
  if (change.maxTokens === null) delete limits.maxTokens
  if (change.maxTokens !== undefined && change.maxTokens !== null) limits.maxTokens = change.maxTokens
  return limits
}

export const since = (total: SessionBudget.Totals, start: SessionBudget.Totals | undefined) =>
  start
    ? {
        cost: Math.max(0, total.cost - start.cost),
        tokens: Math.max(0, total.tokens - start.tokens),
        unpriced: Math.max(0, total.unpriced - start.unpriced),
      }
    : total

export const money = (value: number) => `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`
export const tokens = (value: number) => Math.round(value).toLocaleString("en-US")

export function describe(limits: SessionBudget.Limits, spent: SessionBudget.Totals) {
  return [
    ...(limits.maxCostUsd === undefined
      ? []
      : [
          `${money(spent.cost)} of ${money(limits.maxCostUsd)} spent${spent.unpriced > 0 ? " (some cost unknown)" : ""}`,
        ]),
    ...(limits.maxTokens === undefined ? [] : [`${tokens(spent.tokens)} of ${tokens(limits.maxTokens)} tokens`]),
  ].join(" · ")
}

export function describeLimits(limits: SessionBudget.Limits) {
  return [
    ...(limits.maxCostUsd === undefined ? [] : [money(limits.maxCostUsd)]),
    ...(limits.maxTokens === undefined ? [] : [`${tokens(limits.maxTokens)} tokens`]),
  ].join(" · ")
}

export function check(limits: SessionBudget.Limits, spent: SessionBudget.Totals) {
  const cost = limits.maxCostUsd
  const max = limits.maxTokens
  const costHit = cost !== undefined && spent.cost >= cost
  const tokenHit = max !== undefined && spent.tokens >= max
  return {
    exceeded: costHit || tokenHit,
    unknown: cost !== undefined && spent.unpriced > 0,
    reason: costHit
      ? `${money(spent.cost)} of ${money(cost)} spent`
      : tokenHit
        ? `${tokens(spent.tokens)} of ${tokens(max)} tokens spent`
        : describe(limits, spent),
  }
}

const make = Effect.gen(function* () {
  const store = yield* SessionStore.Service
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const guards = yield* SessionGuardLog.Service

  const totals = Effect.fn("SessionBudget.totals")(function* (sessionID: SessionSchema.ID) {
    const rows = yield* database.db
      .all<{ cost: number; tokens: number }>(
        sql`
        WITH RECURSIVE descendants(id) AS (
          SELECT ${sessionID}
          UNION
          SELECT ${SessionTable.id}
          FROM ${SessionTable}
          JOIN descendants parent ON ${SessionTable.parent_id} = parent.id
        )
        SELECT
          coalesce(sum(${SessionTable.cost}), 0) AS cost,
          coalesce(sum(
            ${SessionTable.tokens_input} +
            ${SessionTable.tokens_output} +
            ${SessionTable.tokens_reasoning} +
            ${SessionTable.tokens_cache_read} +
            ${SessionTable.tokens_cache_write}
          ), 0) AS tokens
        FROM ${SessionTable}
        JOIN descendants ON descendants.id = ${SessionTable.id}
      `,
      )
      .pipe(Effect.orDie)
    return { cost: rows[0]?.cost ?? 0, tokens: rows[0]?.tokens ?? 0, unpriced: 0 }
  })

  const view = Effect.fn("SessionBudget.view")(function* (sessionID: SessionSchema.ID) {
    const session = yield* store.get(sessionID)
    if (!session)
      return SessionBudget.View.make({
        limits: {},
        override: {},
        spent: ZERO,
        exceeded: false,
        unknown: false,
        reason: "",
      })
    const limits = limitsOf(session.metadata?.budget)
    const spent = yield* totals(sessionID)
    const status = check(limits, spent)
    return SessionBudget.View.make({
      limits,
      override: limits,
      spent,
      exceeded: hasLimits(limits) && status.exceeded,
      unknown: status.unknown,
      reason: status.reason,
    })
  })

  const set = Effect.fn("SessionBudget.set")(function* (sessionID: SessionSchema.ID, change: SessionBudget.Update) {
    const session = yield* store.get(sessionID)
    if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
    const budget = update(session.metadata?.budget, change)
    const metadata = { ...session.metadata }
    if (hasLimits(budget)) metadata.budget = budget
    else delete metadata.budget
    yield* bus.publish(SessionEvent.MetadataUpdated, { sessionID, metadata })
    return yield* view(sessionID)
  })

  /** `fallback` is the configured budget, applied to each session of the chain that has none of its own. */
  const admit = Effect.fn("SessionBudget.admit")(function* (
    sessionID: SessionSchema.ID,
    fallback: SessionBudget.Limits = {},
  ) {
    const chain: SessionSchema.Info[] = []
    let current = yield* store.get(sessionID)
    while (current && chain.length < 32) {
      const currentID = current.id
      const parentID = current.parentID
      if (chain.some((session) => session.id === currentID)) break
      chain.push(current)
      current = parentID ? yield* store.get(parentID) : undefined
    }
    for (const [index, session] of chain.entries()) {
      const own = limitsOf(session.metadata?.budget)
      const limits = hasLimits(own) ? own : fallback
      if (!hasLimits(limits)) continue
      const status = check(limits, yield* totals(session.id))
      if (!status.exceeded) continue
      const message =
        index === 0
          ? `Session budget reached: ${status.reason}. Raise it with /budget to continue.`
          : `A subagent stopped: its parent session budget is reached (${status.reason}).`
      yield* guards.record({
        sessionID: session.id,
        guard: "budget",
        action: "stop",
        subject: index === 0 ? "session" : "parent-session",
        detail: message,
      })
      yield* bus.publish(SessionEvent.Synthetic, {
        sessionID,
        text: message,
        description: "Budget reached",
        metadata: { source: "budget", ownerSessionID: session.id },
      })
      return false
    }
    return true
  })

  return { totals, view, set, admit }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/SessionBudget") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Database.node, SessionStore.node, Bus.node, SessionGuardLog.node],
})
