import { Context, Effect, Layer } from "effect"
import type { ProviderMetadata, Usage } from "@reddb-io/redcode-llm"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { ProviderRouter } from "@reddb-io/redcode-core/provider/router"
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
 * judge and title generation are all counted without each of them knowing. Nothing rescans
 * history: a step adds its own usage and nothing else.
 *
 * The persisted `metadata.spend` is the only copy. Each step updates it through
 * `Session.updateMetadata`, which reads the session afresh under that session's metadata lock, so
 * a goal pause, a claim or a compaction written at the same moment is never overwritten, and a
 * write from another process or another writer is always seen.
 *
 * Limits come from two places. A goal carries its own (`goal.budget`), measured from the spend
 * when it was set; the goal runtime enforces those. A session's come from `session.budget` in the
 * configuration, overridden per session through `metadata.budget`; this service checks those,
 * and refuses a subagent's next step once any session above it is out of budget.
 *
 * Counting is per finished step: an attempt that is aborted or fails before the provider reports
 * usage is not counted, so spend can be slightly under the provider's bill.
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

export interface Refusal {
  /** The session whose budget was reached. */
  readonly sessionID: SessionID
  /** With the budget pause prefix, for a goal's pause reason. */
  readonly reason: string
  /** For people: the transcript notice and the toast. */
  readonly message: string
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
  /** Before a provider step: `undefined` to go ahead, or why this session may not spend more. Spends nothing. */
  readonly admit: (input: AdmitInput) => Effect.Effect<Refusal | undefined>
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

/**
 * Whether the model's price is known. A model priced at zero is free, not unknown; only a model
 * the catalog and the configuration gave no price for is.
 */
const priced = (model: Provider.Model) => !model.cost?.unknown

const stateOf = (raw: unknown): State => {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    total: SessionBudget.totalsOf(value),
    ...(value.baseline ? { baseline: SessionBudget.totalsOf(value.baseline) } : {}),
    ...(typeof value.anchor === "string" ? { anchor: value.anchor } : {}),
    warned: Array.isArray(value.warned) ? value.warned.filter((item): item is string => typeof item === "string") : [],
  }
}

const stored = (state: State) => ({
  ...state.total,
  ...(state.baseline ? { baseline: state.baseline } : {}),
  ...(state.anchor ? { anchor: state.anchor } : {}),
  ...(state.warned.length ? { warned: state.warned } : {}),
})

type Configured = { readonly budget?: SessionBudget.Limits & { readonly reset_on_message?: boolean } } | undefined

/** Configured limits bind a top-level session only: a subagent's spend is already its parent's. */
const limitsFor = (metadata: Record<string, unknown> | undefined, parentID: string | undefined, cfg: Configured) => {
  const override = SessionBudget.overrideOf(metadata?.[SessionBudget.LIMITS_KEY])
  return parentID ? override.limits : SessionBudget.merge(cfg?.budget, override.limits)
}

const resetFor = (metadata: Record<string, unknown> | undefined, cfg: Configured) =>
  SessionBudget.overrideOf(metadata?.[SessionBudget.LIMITS_KEY]).reset_on_message ?? cfg?.budget?.reset_on_message === true

/** The warnings one step may raise: 80% of a limit, and a cost limit meeting unpriced spend. Each once. */
function warnings(input: {
  metadata: Record<string, unknown>
  parentID: string | undefined
  state: State
  cfg: Configured
}): Array<{ message: string; subject: string }> {
  const scopes: Array<{ scope: string; label: string; limits: SessionBudget.Limits; spent: SessionBudget.Totals }> = []
  const goal = SessionGoal.fromMetadata(input.metadata)
  if (goal?.status === "active" && goal.budget && SessionBudget.hasLimits(goal.budget))
    scopes.push({
      scope: `goal:${goal.id}`,
      label: "Goal budget",
      limits: goal.budget,
      spent: SessionBudget.since(input.state.total, goal.spendStart),
    })
  const limits = limitsFor(input.metadata, input.parentID, input.cfg)
  if (SessionBudget.hasLimits(limits))
    scopes.push({
      scope: "session",
      label: "Session budget",
      limits,
      spent: SessionBudget.since(input.state.total, input.state.baseline),
    })
  const out: Array<{ message: string; subject: string }> = []
  for (const item of scopes) {
    const status = SessionBudget.check(item.limits, item.spent)
    const once = (kind: string, message: string) => {
      const key = SessionBudget.warningKey(`${item.scope}:${kind}`, item.limits)
      if (input.state.warned.includes(key)) return
      input.state.warned.push(key)
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
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const config = yield* Config.Service
    const events = yield* EventV2Bridge.Service
    const guards = yield* SessionGuardLog.Service

    const read = (sessionID: SessionID) => sessions.get(sessionID).pipe(Effect.orElseSucceed(() => undefined))

    /** The session and its parents, freshly read. */
    const chain = Effect.fn("SessionSpend.chain")(function* (sessionID: SessionID) {
      const out: Session.Info[] = []
      let id: SessionID | undefined = sessionID
      while (id && out.length < MAX_DEPTH && !out.some((item) => item.id === id)) {
        const session: Session.Info | undefined = yield* read(id)
        if (!session) break
        out.push(session)
        id = session.parentID
      }
      return out
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

    const record: Interface["record"] = (input) =>
      Effect.gen(function* () {
        const usage = Session.getUsage({ model: input.model, usage: input.usage, metadata: input.metadata })
        const tokens =
          usage.tokens.input + usage.tokens.output + usage.tokens.reasoning + usage.tokens.cache.read + usage.tokens.cache.write
        if (tokens <= 0 && usage.cost <= 0) return
        const delta: SessionBudget.Totals = {
          cost: usage.cost,
          tokens,
          // A cost the router reported is known even when it is zero.
          unpriced:
            usage.cost > 0 || priced(input.model) || ProviderRouter.reportedCost(input.metadata) !== undefined
              ? 0
              : tokens,
        }
        const cfg = (yield* config.get()).session
        for (const session of yield* chain(input.sessionID as SessionID)) {
          let raised: Array<{ message: string; subject: string }> = []
          yield* sessions.updateMetadata(session.id, (metadata) => {
            const state = stateOf(metadata[SessionBudget.SPEND_KEY])
            state.total = SessionBudget.add(state.total, delta)
            raised = warnings({ metadata, parentID: session.parentID, state, cfg })
            return { ...metadata, [SessionBudget.SPEND_KEY]: stored(state) }
          })
          for (const warning of raised) yield* notify({ sessionID: session.id, action: "warn", ...warning })
        }
      }).pipe(
        // Accounting never fails the stream it watches.
        Effect.catchCause((cause) => Effect.logWarning("spend could not be recorded", { "session.id": input.sessionID, cause })),
      )

    const totals: Interface["totals"] = (sessionID) =>
      read(sessionID).pipe(Effect.map((session) => stateOf(session?.metadata?.[SessionBudget.SPEND_KEY]).total))

    const viewOf = Effect.fn("SessionSpend.viewOf")(function* (session: Session.Info) {
      const cfg = (yield* config.get()).session
      const state = stateOf(session.metadata?.[SessionBudget.SPEND_KEY])
      const limits = limitsFor(session.metadata, session.parentID, cfg)
      const spent = SessionBudget.since(state.total, state.baseline)
      const status = SessionBudget.check(limits, spent)
      return {
        limits,
        override: SessionBudget.overrideOf(session.metadata?.[SessionBudget.LIMITS_KEY]).limits,
        spent,
        exceeded: SessionBudget.hasLimits(limits) && status.exceeded,
        unknown: status.unknown,
        reason: status.reason,
        reset_on_message: resetFor(session.metadata, cfg),
      }
    })

    const empty = {
      limits: {},
      override: {},
      spent: SessionBudget.ZERO,
      exceeded: false,
      unknown: false,
      reason: "",
      reset_on_message: false,
    }

    const view: Interface["view"] = (sessionID) =>
      Effect.gen(function* () {
        const session = yield* read(sessionID)
        return session ? yield* viewOf(session) : empty
      })

    const setLimits: Interface["setLimits"] = (sessionID, change) =>
      Effect.gen(function* () {
        yield* sessions.updateMetadata(sessionID, (metadata) => {
          const next = SessionBudget.updateOverride(metadata[SessionBudget.LIMITS_KEY], change)
          const { [SessionBudget.LIMITS_KEY]: _previous, ...rest } = metadata
          return next ? { ...rest, [SessionBudget.LIMITS_KEY]: next } : rest
        })
        return yield* view(sessionID)
      })

    const admit: Interface["admit"] = (input) =>
      Effect.gen(function* () {
        const cfg = (yield* config.get()).session
        const sessionsAbove = yield* chain(input.sessionID)
        for (const [index, found] of sessionsAbove.entries()) {
          let session = found
          if (
            index === 0 &&
            input.human &&
            input.messageID &&
            stateOf(session.metadata?.[SessionBudget.SPEND_KEY]).anchor !== input.messageID &&
            resetFor(session.metadata, cfg)
          ) {
            const anchor = input.messageID
            const metadata = yield* sessions.updateMetadata(session.id, (current) => {
              const state = stateOf(current[SessionBudget.SPEND_KEY])
              if (state.anchor === anchor) return current
              return { ...current, [SessionBudget.SPEND_KEY]: stored({ ...state, baseline: state.total, anchor }) }
            })
            session = { ...session, metadata }
          }
          const state = stateOf(session.metadata?.[SessionBudget.SPEND_KEY])
          const limits = limitsFor(session.metadata, session.parentID, cfg)
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
                sessionID: session.id,
                reason: `${SessionBudget.pauseReason(status)} by the parent goal`,
                message: `A subagent stopped: the goal's budget is reached (${status.reason}).`,
              }
          }
        }
        return undefined
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
