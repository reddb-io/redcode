import { Context, Effect, Layer, Scope } from "effect"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { RouterMCP } from "@reddb-io/redcode-core/provider/router-mcp"
import type { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { ModelSuggestion } from "@reddb-io/redcode-schema/model-suggestion"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Provider } from "@/provider/provider"
import { RedRouter } from "@/provider/red-router"
import type { SessionID } from "./schema"

/**
 * Suggests another model or combo of the session's RedRouter connection when a deterministic
 * trigger fires, asking the router's MCP server (`recommend_models`) for candidates. It only ever
 * publishes a suggestion: the person switches (or keeps the model) from the card a client shows,
 * and nothing here changes the session's model. Off when the router has no MCP of schema version
 * 2, when the model is not served by a RedRouter connection, and when
 * `experimental.model_suggestions` is false.
 *
 * A session is offered at most one suggestion per trigger while its situation (the model in use)
 * stays the same, and never again for a trigger the person chose to keep the model for.
 *
 * Only `recommend_models` names candidates, and only those the router calls usable right now are
 * offered: redcode's own catalog cannot see quotas. A switch asks the router once more (`get_model`)
 * and does not happen when the suggested model has become unusable since.
 */

/** Share of the usable context in use at which a larger context is suggested. */
export const CONTEXT_SHARE = 0.85
/** A cheaper equivalent is suggested only when it costs at least this much less, in percent. */
export const CHEAPER_PCT = -40
/** Spend over the last day, in USD, below which a cheaper equivalent is not worth a suggestion. */
export const SPEND_FLOOR_USD = 1
/** Provider failures in a row after which an equivalent is suggested without asking about health. */
export const REPEATED_FAILURES = 2
/** A quota window with this share left, in percent, is nearly used up... */
export const QUOTA_LOW_PCT = 10
/** ...unless it resets within this long. */
export const QUOTA_RESET_SOON_MS = 60 * 60_000
/** Router states of the current model that make an equivalent worth suggesting after one failure. */
const UNHEALTHY = new Set(["rate_limited", "quota_exhausted", "error", "disabled"])
const RECOMMENDATIONS = 5

type Model = Pick<Provider.Model, "id" | "providerID" | "api" | "capabilities" | "limit" | "pinOf">

export type Request = {
  readonly trigger: ModelSuggestion.Trigger
  readonly args: RouterMCP.RecommendArgs
}

export interface ObserveInput {
  readonly sessionID: SessionID
  readonly model: Provider.Model
  /** The session's history as this step sends it. */
  readonly messages: ReadonlyArray<SessionV1.WithParts>
  /** Whether this step offers the model tools. */
  readonly tools: boolean
  /** The session's latest finished assistant message, whose usage measures the context in use. */
  readonly finished?: SessionV1.Assistant
  /** Tokens of context the model can take for input. */
  readonly usable: number
}

export interface Interface {
  /** Before a provider step: when a trigger fires, asks the router in the background. Never waits on it. */
  readonly observe: (input: ObserveInput) => Effect.Effect<void>
  /**
   * A provider attempt failed: counts toward the provider-errors trigger. A failure with `until`
   * (a quota that resets too far off to wait for) asks for an equivalent at once.
   */
  readonly failure: (input: {
    readonly sessionID: SessionID
    readonly model: Provider.Model
    readonly status?: number
    readonly until?: number
  }) => Effect.Effect<void>
  /** A provider step succeeded: failures no longer repeat. */
  readonly recovered: (sessionID: SessionID) => Effect.Effect<void>
  /**
   * The person answered a suggestion. `keep` silences its trigger for the rest of the session.
   * `switch` asks the router whether the suggested model is still usable: false means it is not, and
   * the client must not switch.
   */
  readonly resolve: (input: {
    readonly sessionID: SessionID
    readonly trigger: ModelSuggestion.Trigger
    readonly choice: ModelSuggestion.Choice
  }) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/SessionModelSuggestion") {}

type State = {
  /** The situation each trigger was last asked about, so an unchanged one is not asked again. */
  readonly asked: Map<ModelSuggestion.Trigger, string>
  readonly kept: Set<ModelSuggestion.Trigger>
  failures: number
  /** Checks already made for a model: its health after a single failure, its provider's quotas. */
  readonly probed: Set<string>
  /** The suggestion each trigger last published, to ask the router about again before a switch. */
  readonly shown: Map<ModelSuggestion.Trigger, Shown>
}

/** A published suggestion's target as the router knows it: its id and, for a pinned offer, the pin id. */
type Shown = { readonly mcp: RouterMCP.Input; readonly id: string; readonly pin: string }

type Reason = ModelSuggestion.Info["why"][number]

// Process-local like the drain. Bounded: a session evicted here may be offered a suggestion again.
const LIMIT = 1000
const CHEAPER_KEY = "session"

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const providers = yield* Provider.Service
    const auth = yield* Auth.Service
    const events = yield* EventV2Bridge.Service
    const scope = yield* Scope.Scope
    const states = new Map<string, State>()

    const stateOf = (sessionID: SessionID) => {
      const state = states.get(sessionID) ?? {
        asked: new Map(),
        kept: new Set(),
        failures: 0,
        probed: new Set(),
        shown: new Map(),
      }
      states.delete(sessionID)
      states.set(sessionID, state)
      if (states.size > LIMIT) states.delete(states.keys().next().value!)
      return state
    }

    // Everything that can be decided without the network: the setting, and a RedRouter connection
    // with an address and credential behind the model.
    const connectionOf = Effect.fnUntraced(function* (model: Provider.Model) {
      if ((yield* config.get()).experimental?.model_suggestions === false) return
      // A model whose provider is gone resolves to none at runtime, whatever the type says.
      const provider: Provider.Info | undefined = yield* providers.getProvider(model.providerID)
      const baseURL = provider?.options.baseURL
      if (!provider || !RedRouter.isConnection(provider) || typeof baseURL !== "string") return
      const info = yield* auth.get(model.providerID).pipe(Effect.orElseSucceed(() => undefined))
      const configured = provider.options.apiKey
      const apiKey = info?.type === "api" ? info.key : typeof configured === "string" ? configured : provider.key
      return { provider, mcp: { baseURL, apiKey } }
    })

    const suggest = Effect.fnUntraced(function* (input: {
      readonly sessionID: SessionID
      readonly model: Provider.Model
      readonly connection: { readonly provider: Provider.Info; readonly mcp: RouterMCP.Input }
      readonly request: Request
      readonly key: string
      readonly needs: ReadonlyArray<string>
      /** Undefined to look no further; otherwise reasons to show before the router's own. */
      readonly gate?: (mcp: RouterMCP.Input) => Effect.Effect<ReadonlyArray<Reason> | undefined>
      /** When the current model's quota resets, already known to be exhausted. */
      readonly until?: number
    }) {
      const state = stateOf(input.sessionID)
      const version = yield* RouterMCP.version(input.connection.mcp)
      if (version === undefined) return
      const gated = input.gate ? yield* input.gate(input.connection.mcp) : []
      if (!gated) return
      state.asked.set(input.request.trigger, input.key)
      const result = yield* RouterMCP.recommend(input.connection.mcp, input.request.args)
      if (!result) return
      const chosen = choose(result, {
        trigger: input.request.trigger,
        needs: input.needs,
        current: input.model,
        models: input.connection.provider.models,
        version,
        until: input.until,
        exhausted: input.until !== undefined || gated.some((reason) => reason.code === "quota_exhausted"),
      })
      // The person may have kept the model for this trigger while the router was answering.
      if (!chosen || state.kept.has(input.request.trigger)) return
      // The router may give the same reason itself (schema 4 says when the current model is out of quota).
      const reasons = gated.filter((reason) => !chosen.suggestion.why.some((item) => item.code === reason.code))
      state.shown.set(input.request.trigger, {
        mcp: input.connection.mcp,
        id: chosen.id,
        pin: chosen.suggestion.model.modelID,
      })
      yield* events.publish(ModelSuggestion.Suggested, {
        sessionID: input.sessionID,
        suggestion: reasons.length
          ? {
              ...chosen.suggestion,
              why: [...reasons, ...chosen.suggestion.why],
              whyText: [...reasons.map((reason) => reason.detail), chosen.suggestion.whyText]
                .filter(Boolean)
                .join("; "),
            }
          : chosen.suggestion,
      })
    })

    const observe = Effect.fn("SessionModelSuggestion.observe")(function* (input: ObserveInput) {
      const connection = yield* connectionOf(input.model)
      if (!connection) return
      const state = stateOf(input.sessionID)
      const needs = sessionNeeds(input)
      const tokens = contextInUse(input)
      const found = detect({ model: input.model, needs, tokens, usable: input.usable })
      const open = (trigger: ModelSuggestion.Trigger, key: string) =>
        !state.kept.has(trigger) && state.asked.get(trigger) !== key
      if (found) {
        if (!open(found.trigger, input.model.id)) return
        state.asked.set(found.trigger, input.model.id)
        yield* suggest({ ...input, connection, request: found, key: input.model.id, needs }).pipe(
          Effect.ignore,
          Effect.forkIn(scope),
        )
        return
      }
      // A router that reports quotas (schema 3) is asked once per model whether its provider's are
      // nearly used up, before that model fails for it.
      const quotaCheck = `quota:${input.model.id}`
      if (open("provider_errors", input.model.id) && !state.probed.has(quotaCheck)) {
        state.probed.add(quotaCheck)
        yield* suggest({
          ...input,
          connection,
          request: { trigger: "provider_errors", args: equivalent(input.model, needs) },
          key: input.model.id,
          needs,
          gate: (mcp) => quotaReasons(mcp, input.model),
        }).pipe(Effect.ignore, Effect.forkIn(scope))
        return
      }
      // A cheaper equivalent is looked for once per session, after the model has answered once.
      if (tokens === undefined || !open("cheaper", CHEAPER_KEY)) return
      state.asked.set("cheaper", CHEAPER_KEY)
      yield* suggest({
        ...input,
        connection,
        request: { trigger: "cheaper", args: equivalent(input.model, needs) },
        key: CHEAPER_KEY,
        needs,
        gate: (mcp) =>
          RouterMCP.usage(mcp, 24).pipe(
            Effect.map((usage) => ((usage?.totals.cost ?? 0) >= SPEND_FLOOR_USD ? [] : undefined)),
          ),
      }).pipe(Effect.ignore, Effect.forkIn(scope))
    }, Effect.catchCause(() => Effect.void))

    const failure = Effect.fn("SessionModelSuggestion.failure")(function* (input: {
      readonly sessionID: SessionID
      readonly model: Provider.Model
      readonly status?: number
      readonly until?: number
    }) {
      if (!providerFailure(input.status) && input.until === undefined) return
      const connection = yield* connectionOf(input.model)
      if (!connection) return
      const state = stateOf(input.sessionID)
      state.failures += 1
      const key = input.model.id
      if (state.kept.has("provider_errors") || state.asked.get("provider_errors") === key) return
      const until = input.until
      // An exhausted quota is known unusable until it resets: nothing to ask the router first.
      const repeated = state.failures >= REPEATED_FAILURES || until !== undefined
      // After one failure the router is asked once whether the model is rate limited or unhealthy;
      // after repeated failures an equivalent is looked for whatever it says.
      const healthCheck = `health:${key}`
      if (!repeated && state.probed.has(healthCheck)) return
      if (repeated) state.asked.set("provider_errors", key)
      else state.probed.add(healthCheck)
      yield* suggest({
        ...input,
        connection,
        request: { trigger: "provider_errors", args: equivalent(input.model, []) },
        key,
        needs: [],
        gate:
          until !== undefined
            ? () => Effect.succeed([OUT_OF_QUOTA])
            : repeated
              ? undefined
              : (mcp) =>
                  RouterMCP.model(mcp, routerID(input.model)).pipe(
                    Effect.map((summary) => {
                      if (!summary || !UNHEALTHY.has(summary.status.state)) return undefined
                      return summary.status.state === "quota_exhausted" ? [OUT_OF_QUOTA] : []
                    }),
                  ),
      }).pipe(Effect.ignore, Effect.forkIn(scope))
    }, Effect.catchCause(() => Effect.void))

    const recovered = Effect.fn("SessionModelSuggestion.recovered")(function* (sessionID: SessionID) {
      const state = states.get(sessionID)
      if (state) state.failures = 0
    })

    const resolve = Effect.fn("SessionModelSuggestion.resolve")(function* (input: {
      readonly sessionID: SessionID
      readonly trigger: ModelSuggestion.Trigger
      readonly choice: ModelSuggestion.Choice
    }) {
      const state = stateOf(input.sessionID)
      const shown = state.shown.get(input.trigger)
      state.shown.delete(input.trigger)
      if (input.choice === "keep") state.kept.add(input.trigger)
      const usable = input.choice === "switch" && shown ? yield* stillUsable(shown) : true
      // Another target may be looked for the next time the trigger fires.
      if (!usable) state.asked.delete(input.trigger)
      // Every client drops the card either way; only the one that answered switches, and only when usable.
      yield* events.publish(ModelSuggestion.Resolved, input)
      return usable
    })

    return Service.of({ observe, failure, recovered, resolve })
  }),
)

/**
 * The first trigger the step fires, in order of how badly the session needs another model: images
 * the model cannot see, tools it cannot call, a context close to its limit.
 */
export function detect(input: {
  readonly model: Model
  readonly needs: ReadonlyArray<string>
  readonly tokens?: number
  readonly usable: number
}): Request | undefined {
  const base = { needs: [...input.needs], current: routerID(input.model), limit: RECOMMENDATIONS }
  if (input.needs.includes("vision") && !input.model.capabilities.input.image) return { trigger: "vision", args: base }
  if (input.needs.includes("tools") && !input.model.capabilities.toolcall) return { trigger: "tools", args: base }
  if (input.tokens !== undefined && input.usable > 0 && input.tokens >= input.usable * CONTEXT_SHARE)
    return {
      trigger: "context",
      args: { ...base, needs_input_tokens: input.tokens, min_context: input.model.limit.context + 1 },
    }
  return undefined
}

/** The capabilities the session relies on: vision and pdf for what was attached, tools when the step has any. */
export function sessionNeeds(input: {
  readonly messages: ReadonlyArray<SessionV1.WithParts>
  readonly tools: boolean
}) {
  const mimes = input.messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type === "file") return [part.mime]
      if (part.type === "tool" && part.state.status === "completed")
        return (part.state.attachments ?? []).map((file) => file.mime)
      return []
    }),
  )
  return [
    ...(mimes.some((mime) => mime.startsWith("image/")) ? ["vision"] : []),
    ...(mimes.includes("application/pdf") ? ["pdf"] : []),
    ...(input.tools ? ["tools"] : []),
  ]
}

/**
 * The first recommendation worth a switch, as a model of the same connection, with the id the router
 * knows it by. Never one the router cannot serve now (`RouterMCP.usable` for the router's schema
 * `version`), the current model itself, one that loses a capability the session needs, or one this
 * connection does not list. While the current model is out of quota, never one of its provider
 * either. An equivalent (provider errors, cheaper) loses no capability at all, and a cheaper one costs
 * at least `CHEAPER_PCT` less.
 */
export function choose(
  result: RouterMCP.Recommended,
  input: {
    readonly trigger: ModelSuggestion.Trigger
    readonly needs: ReadonlyArray<string>
    readonly current: Model
    readonly models: Readonly<Record<string, Model>>
    /** The router's MCP schema; the oldest this client reads when unknown. */
    readonly version?: number
    /** Whether the current model is known to be out of quota, whatever the router says of it. */
    readonly exhausted?: boolean
    /** When the current model's quota resets, when known. */
    readonly until?: number
  },
): { readonly id: string; readonly suggestion: ModelSuggestion.Info } | undefined {
  const required = [
    ...input.needs,
    ...(input.trigger === "vision" ? ["vision"] : []),
    ...(input.trigger === "tools" ? ["tools"] : []),
  ]
  const version = input.version ?? RouterMCP.SCHEMA_VERSION
  const current = result.current
  const exhausted = input.exhausted === true || current?.status.state === "quota_exhausted"
  const spent = exhausted ? current?.provider?.id : undefined
  const until = input.until ?? (exhausted ? Date.parse(current?.status.until ?? "") : Number.NaN)
  return result.recommendations.flatMap((recommendation) => {
    if (!RouterMCP.usable(recommendation, version)) return []
    if (recommendation.id === routerID(input.current)) return []
    if (spent && recommendation.provider?.id === spent) return []
    const lost = recommendation.delta?.lost_capabilities ?? []
    if (lost.some((capability) => required.includes(capability))) return []
    if (required.some((capability) => !recommendation.capabilities.includes(capability))) return []
    // An equivalent loses nothing, whatever the session has needed so far.
    if ((input.trigger === "cheaper" || input.trigger === "provider_errors") && lost.length > 0) return []
    const pct = recommendation.delta?.price_delta_pct
    if (input.trigger === "cheaper" && (pct === null || pct === undefined || pct > CHEAPER_PCT)) return []
    const target = targetOf(recommendation, input.models, input.current.pinOf !== undefined)
    if (!target || target.id === input.current.id) return []
    const suggestion: ModelSuggestion.Info = {
      trigger: input.trigger,
      current: { providerID: input.current.providerID, modelID: input.current.id },
      model: { providerID: target.providerID, modelID: target.id },
      name: recommendation.name,
      kind: recommendation.kind,
      why: recommendation.why.map((reason) => ({ code: reason.code, detail: reason.detail })),
      whyText: recommendation.why_text,
      ...(recommendation.delta
        ? {
            delta: {
              pricePct: recommendation.delta.price_delta_pct,
              context: recommendation.delta.context_delta,
              gained: [...recommendation.delta.gained_capabilities],
              lost: [...recommendation.delta.lost_capabilities],
            },
          }
        : {}),
      ...(Number.isFinite(until) ? { until } : {}),
    }
    return [{ id: recommendation.id, suggestion }]
  })[0]
}

/**
 * The connection's model a recommendation is selected as. A flat model is selected by its own id,
 * or by the pin id of an available offer when the flat id is not listed or the person pins offers
 * (the current model is a pinned offer): then the router's first available offer is suggested.
 */
export function targetOf(
  recommendation: RouterMCP.Recommendation,
  models: Readonly<Record<string, Model>>,
  preferPin: boolean,
) {
  const listed = Object.values(models)
  const direct = listed.find((model) => model.id === recommendation.id || model.api.id === recommendation.id)
  const pinned = (recommendation.offers ?? [])
    .filter((offer) => offer.available && offer.pin_id)
    .flatMap((offer) => listed.filter((model) => model.id === offer.pin_id))
  return preferPin ? (pinned[0] ?? direct) : (direct ?? pinned[0])
}

/**
 * Whether every account of `provider` that reported quotas has one nearly used up (at most
 * `QUOTA_LOW_PCT` left) that does not reset soon. Accounts that failed to report are left out; a
 * provider none of whose accounts reported is not judged.
 */
export function quotasSpent(quotas: RouterMCP.Quotas | undefined, provider: string, now: number) {
  const accounts = (quotas?.providers ?? [])
    .filter((item) => item.provider === provider)
    .flatMap((item) => item.accounts)
    .filter((account) => !account.error && account.quotas.length > 0)
  return accounts.length > 0 && accounts.every((account) => account.quotas.some((quota) => spent(quota, now)))
}

function spent(quota: RouterMCP.Quota, now: number) {
  if (quota.unlimited || quota.remaining_pct === null || quota.remaining_pct === undefined) return false
  if (quota.remaining_pct > QUOTA_LOW_PCT) return false
  const reset = quota.reset_at ? Date.parse(quota.reset_at) : Number.NaN
  return Number.isNaN(reset) || reset - now > QUOTA_RESET_SOON_MS
}

const OUT_OF_QUOTA: Reason = { code: "quota_exhausted", detail: "the current model is out of quota" }

/**
 * The quota reason for an equivalent: the router says the model is out of quota (schema 4), or its
 * quota report says the provider is nearly spent (schema 3).
 */
const quotaReasons = (mcp: RouterMCP.Input, model: Model) =>
  Effect.gen(function* () {
    if (((yield* RouterMCP.version(mcp)) ?? 0) < RouterMCP.QUOTAS_VERSION) return undefined
    const summary = yield* RouterMCP.model(mcp, routerID(model))
    if (summary?.status.state === "quota_exhausted") return [OUT_OF_QUOTA]
    const provider = summary?.provider
    if (!provider) return undefined
    if (!quotasSpent(yield* RouterMCP.quotas(mcp, provider.id), provider.id, Date.now())) return undefined
    return [{ code: "quota", detail: `${provider.name ?? provider.id} quotas are nearly used up` }]
  })

/**
 * Whether a published suggestion's target is still usable, asked right before a switch. A router
 * that cannot answer now (no MCP, a timeout, an unknown id) does not stop the switch.
 */
const stillUsable = (shown: Shown) =>
  Effect.gen(function* () {
    const summary = yield* RouterMCP.model(shown.mcp, shown.id)
    if (!summary) return true
    if (!RouterMCP.usable(summary, (yield* RouterMCP.version(shown.mcp)) ?? RouterMCP.SCHEMA_VERSION)) return false
    return summary.offers?.find((offer) => offer.pin_id === shown.pin)?.available ?? true
  }).pipe(Effect.catchCause(() => Effect.succeed(true)))

/** The id the router knows the model by. A pinned offer is asked about as its flat model. */
export function routerID(model: Model) {
  return model.pinOf ?? model.api.id
}

function equivalent(model: Model, needs: ReadonlyArray<string>): RouterMCP.RecommendArgs {
  const id = routerID(model)
  return { needs: [...needs], current: id, equivalent_to: id, prefer: "cheapest", limit: RECOMMENDATIONS }
}

/** Tokens the latest answer from this very model had in context; undefined before it answered. */
function contextInUse(input: ObserveInput) {
  const finished = input.finished
  if (!finished || finished.summary) return
  if (finished.providerID !== input.model.providerID || finished.modelID !== input.model.id) return
  const tokens = finished.tokens
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

/** Failures worth an equivalent: rate limits, payment, server errors, and retried attempts (no status). */
function providerFailure(status: number | undefined) {
  return status === undefined || status === 402 || status === 429 || status >= 500
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Provider.node, Auth.node, EventV2Bridge.node],
})

export * as SessionModelSuggestion from "./model-suggestion"
