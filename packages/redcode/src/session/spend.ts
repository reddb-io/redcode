import { Context, Effect, Layer, Semaphore } from "effect"
import type { ProviderMetadata, Usage } from "@reddb-io/redcode-llm"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import type { Provider } from "@/provider/provider"
import { TuiEvent } from "@/server/tui-event"
import { SessionBudget } from "./budget"
import { SessionGoal } from "./goal"
import { SessionGuardLog } from "./guard-log"
import type { SessionID } from "./schema"
import { Session } from "./session"

/**
 * The spend ledger: every finished provider step, charged to the session that made it and to
 * every session above it.
 *
 * It is fed from one place — the LLM stream — so the main turn, subagents, compaction, the goal
 * judge and title generation are all counted without each of them knowing. Totals are kept in
 * memory and mirrored to `metadata.spend` on every step, so a restarted process picks up where the
 * last one left off and clients can show the running figure. Nothing rescans history: a step adds
 * its own usage and nothing else.
 *
 * Limits come from two places. A goal carries its own (`goal.budget`), measured from the spend
 * when it was set; the goal runtime enforces those. A session's come from `session.budget` in the
 * configuration, overridden per session through `metadata.budget`; this service enforces those,
 * and refuses a subagent's next step once any session above it is out of budget.
 */

export interface RecordInput {
  readonly sessionID: string
  readonly model: Provider.Model
  readonly usage: Usage
  readonly metadata?: ProviderMetadata
}

export interface AdmitInput {
  readonly sessionID: SessionID
  /** The user message the step answers; with `human`, re-arms a `reset_on_message` budget. */
  readonly messageID?: string
  readonly human?: boolean
}

export interface Interface {
  readonly record: (input: RecordInput) => Effect.Effect<void>
  /** Everything this session and its subagents have spent. */
  readonly totals: (sessionID: SessionID) => Effect.Effect<SessionBudget.Totals>
  readonly view: (sessionID: SessionID) => Effect.Effect<typeof SessionBudget.View.Type>
  readonly setLimits: (
    sessionID: SessionID,
    change: typeof SessionBudget.UpdatePayload.Type,
  ) => Effect.Effect<typeof SessionBudget.View.Type>
  /**
   * Before a provider attempt: `undefined` to go ahead, or the reason (with the budget pause
   * prefix) this session may not spend more. Spends nothing.
   */
  readonly admit: (input: AdmitInput) => Effect.Effect<string | undefined>
  /** A budget notice for whoever is watching: a toast and a guard log entry. */
  readonly notify: (input: {
    sessionID: SessionID
    message: string
    action: "warn" | "stop"
    subject: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/SessionSpend") {}

interface State {
  total: SessionBudget.Totals
  /** Where a `reset_on_message` session budget counts from. */
  baseline?: SessionBudget.Totals
  /** The user message the baseline was taken at. */
  anchor?: string
  /** Warnings already given; keyed by the limits, so raising a limit re-arms them. */
  warned: string[]
}

/** Deeper than any real subagent chain; a guard against a parent cycle in bad data. */
const MAX_DEPTH = 32

const priced = (model: Provider.Model) => {
  const cost = model.cost
  if (!cost) return false
  return (
    cost.input > 0 ||
    cost.output > 0 ||
    (cost.cache?.read ?? 0) > 0 ||
    (cost.cache?.write ?? 0) > 0 ||
    (cost.tiers?.length ?? 0) > 0
  )
}

const stateOf = (raw: unknown): State => {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    total: SessionBudget.totalsOf(value),
    ...(value.baseline ? { baseline: SessionBudget.totalsOf(value.baseline) } : {}),
    ...(typeof value.anchor === "string" ? { anchor: value.anchor } : {}),
    warned: Array.isArray(value.warned) ? value.warned.filter((item): item is string => typeof item === "string") : [],
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const config = yield* Config.Service
    const events = yield* EventV2Bridge.Service
    const guards = yield* SessionGuardLog.Service
    const states = new Map<SessionID, State>()
    // One writer at a time: parallel subagents finish steps together, and each write is a
    // read-modify-write of the session's metadata.
    const lock = yield* Semaphore.make(1)

    const read = Effect.fn("SessionSpend.read")(function* (sessionID: SessionID) {
      const session = yield* sessions.get(sessionID).pipe(Effect.orElseSucceed(() => undefined))
      if (!session) return undefined
      let state = states.get(sessionID)
      if (!state) {
        state = stateOf(session.metadata?.[SessionBudget.SPEND_KEY])
        states.set(sessionID, state)
      }
      return { session, state }
    })

    const persist = Effect.fn("SessionSpend.persist")(function* (session: Session.Info, state: State) {
      yield* sessions.setMetadata({
        sessionID: session.id,
        metadata: {
          ...session.metadata,
          [SessionBudget.SPEND_KEY]: {
            ...state.total,
            ...(state.baseline ? { baseline: state.baseline } : {}),
            ...(state.anchor ? { anchor: state.anchor } : {}),
            ...(state.warned.length ? { warned: state.warned } : {}),
          },
        },
      })
    })

    /** Configured limits bound a top-level session only: a subagent's spend is already its parent's. */
    const limitsFor = Effect.fn("SessionSpend.limitsFor")(function* (session: Session.Info) {
      const override = SessionBudget.limitsOf(session.metadata?.[SessionBudget.LIMITS_KEY])
      if (session.parentID) return override
      const cfg = yield* config.get()
      return SessionBudget.merge(cfg.session?.budget, override)
    })

    const notify: Interface["notify"] = (input) =>
      Effect.all(
        [
          events
            .publish(TuiEvent.ToastShow, {
              title: input.action === "stop" ? "Budget reached" : "Budget",
              message: input.message,
              variant: input.action === "stop" ? "error" : "warning",
              duration: input.action === "stop" ? 10_000 : 6_000,
            })
            .pipe(Effect.ignore),
          guards.record({
            sessionID: input.sessionID,
            guard: "budget",
            action: input.action,
            subject: input.subject,
            detail: input.message,
          }),
        ],
        { discard: true },
      )

    /** The warnings one step may raise: 80% of a limit, and a cost limit meeting unpriced spend. Each once. */
    const warnings = Effect.fn("SessionSpend.warnings")(function* (session: Session.Info, state: State) {
      const scopes: Array<{
        scope: string
        label: string
        limits: SessionBudget.Limits
        spent: SessionBudget.Totals
      }> = []
      const goal = SessionGoal.fromMetadata(session.metadata)
      if (goal?.status === "active" && goal.budget && SessionBudget.hasLimits(goal.budget))
        scopes.push({
          scope: `goal:${goal.id}`,
          label: "Goal budget",
          limits: goal.budget,
          spent: SessionBudget.since(state.total, goal.spendStart),
        })
      const limits = yield* limitsFor(session)
      if (SessionBudget.hasLimits(limits))
        scopes.push({
          scope: "session",
          label: "Session budget",
          limits,
          spent: SessionBudget.since(state.total, state.baseline),
        })
      const out: Array<{ message: string; subject: string }> = []
      for (const item of scopes) {
        const status = SessionBudget.check(item.limits, item.spent)
        const once = (kind: string, message: string) => {
          const key = SessionBudget.warningKey(`${item.scope}:${kind}`, item.limits)
          if (state.warned.includes(key)) return
          state.warned.push(key)
          out.push({ message, subject: kind })
        }
        if (status.unknown)
          once(
            "unknown",
            `${item.label}: a model in use has no pricing, so part of the cost is unknown. ${
              item.limits.max_tokens !== undefined
                ? "The token limit still applies."
                : "Only the known cost counts; set a token limit to bound the rest."
            }`,
          )
        if (status.warn && !status.exceeded)
          once("warn", `${item.label} ${Math.floor(status.used * 100)}% used: ${SessionBudget.describe(item.limits, item.spent)}`)
      }
      return out
    })

    const chain = Effect.fn("SessionSpend.chain")(function* (sessionID: SessionID) {
      const out: Array<{ session: Session.Info; state: State }> = []
      let id: SessionID | undefined = sessionID
      while (id && out.length < MAX_DEPTH && !out.some((item) => item.session.id === id)) {
        const entry: { session: Session.Info; state: State } | undefined = yield* read(id)
        if (!entry) break
        out.push(entry)
        id = entry.session.parentID
      }
      return out
    })

    const record: Interface["record"] = (input) =>
      Effect.gen(function* () {
        const usage = Session.getUsage({ model: input.model, usage: input.usage, metadata: input.metadata })
        const tokens =
          usage.tokens.input + usage.tokens.output + usage.tokens.reasoning + usage.tokens.cache.read + usage.tokens.cache.write
        if (tokens <= 0 && usage.cost <= 0) return
        const delta: SessionBudget.Totals = {
          cost: usage.cost,
          tokens,
          unpriced: usage.cost > 0 || priced(input.model) ? 0 : tokens,
        }
        const notices = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            const found: Array<{ sessionID: SessionID; message: string; subject: string }> = []
            for (const { session, state } of yield* chain(input.sessionID as SessionID)) {
              state.total = SessionBudget.add(state.total, delta)
              for (const warning of yield* warnings(session, state)) found.push({ sessionID: session.id, ...warning })
              yield* persist(session, state)
            }
            return found
          }),
        )
        for (const notice of notices) yield* notify({ ...notice, action: "warn" })
      }).pipe(
        // Accounting never fails the stream it watches.
        Effect.catchCause((cause) => Effect.logWarning("spend could not be recorded", { "session.id": input.sessionID, cause })),
      )

    const totals: Interface["totals"] = (sessionID) =>
      read(sessionID).pipe(Effect.map((entry) => entry?.state.total ?? SessionBudget.ZERO))

    const viewOf = Effect.fn("SessionSpend.viewOf")(function* (session: Session.Info, state: State) {
      const limits = yield* limitsFor(session)
      const spent = SessionBudget.since(state.total, state.baseline)
      const status = SessionBudget.check(limits, spent)
      return {
        limits,
        override: SessionBudget.limitsOf(session.metadata?.[SessionBudget.LIMITS_KEY]),
        spent,
        exceeded: SessionBudget.hasLimits(limits) && status.exceeded,
        unknown: status.unknown,
        reason: status.reason,
      }
    })

    const view: Interface["view"] = (sessionID) =>
      Effect.gen(function* () {
        const entry = yield* read(sessionID)
        if (!entry)
          return { limits: {}, override: {}, spent: SessionBudget.ZERO, exceeded: false, unknown: false, reason: "" }
        return yield* viewOf(entry.session, entry.state)
      })

    const setLimits: Interface["setLimits"] = (sessionID, change) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
          const next = SessionBudget.update(SessionBudget.limitsOf(session.metadata?.[SessionBudget.LIMITS_KEY]), change)
          const metadata = { ...session.metadata }
          if (SessionBudget.hasLimits(next)) metadata[SessionBudget.LIMITS_KEY] = next
          else delete metadata[SessionBudget.LIMITS_KEY]
          yield* sessions.setMetadata({ sessionID, metadata })
          const entry = yield* read(sessionID)
          if (!entry) return yield* Effect.die(new Error(`session ${sessionID} disappeared`))
          return yield* viewOf(entry.session, entry.state)
        }),
      )

    const admit: Interface["admit"] = (input) =>
      Effect.gen(function* () {
        const denied = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            const cfg = yield* config.get()
            const entries = yield* chain(input.sessionID)
            for (const [index, { session, state }] of entries.entries()) {
              if (
                index === 0 &&
                input.human &&
                input.messageID &&
                state.anchor !== input.messageID &&
                cfg.session?.budget?.reset_on_message === true
              ) {
                state.baseline = state.total
                state.anchor = input.messageID
                yield* persist(session, state)
              }
              const limits = yield* limitsFor(session)
              if (SessionBudget.hasLimits(limits)) {
                const status = SessionBudget.check(limits, SessionBudget.since(state.total, state.baseline))
                if (status.exceeded)
                  return {
                    sessionID: session.id,
                    reason: `${SessionBudget.pauseReason(status)}${index === 0 ? "" : " by the parent session"}`,
                    message:
                      index === 0
                        ? `Session budget reached: ${status.reason}. Raise it with /budget to continue.`
                        : `A subagent stopped: its parent session's budget is reached (${status.reason}).`,
                  }
              }
              // This session's own goal is the goal runtime's to enforce; a parent's goal still
              // stops its subagents from spending more.
              const goal = index === 0 ? undefined : SessionGoal.fromMetadata(session.metadata)
              if (goal?.status === "active" && goal.budget && SessionBudget.hasLimits(goal.budget)) {
                const status = SessionBudget.check(goal.budget, SessionBudget.since(state.total, goal.spendStart))
                if (status.exceeded)
                  return {
                    sessionID: input.sessionID,
                    reason: `${SessionBudget.pauseReason(status)} by the parent goal`,
                    message: `A subagent stopped: the goal's budget is reached (${status.reason}).`,
                  }
              }
            }
            return undefined
          }),
        )
        if (!denied) return undefined
        yield* notify({ sessionID: denied.sessionID, message: denied.message, action: "stop", subject: "session" })
        return denied.reason
      })

    return Service.of({ record, totals, view, setLimits, admit, notify })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Session.node, Config.node, EventV2Bridge.node, SessionGuardLog.node],
})

export * as SessionSpend from "./spend"
