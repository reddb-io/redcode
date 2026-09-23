import { ProviderRouter } from "@reddb-io/redcode-core/provider/router"
import type { ConfigProviderV1 } from "@reddb-io/redcode-core/v1/config/provider"
import { isRecord } from "@/util/record"
import type { Provider } from "./provider"
import { ProviderDiscovery } from "./discovery"
import { ProviderTransform } from "./transform"

/**
 * A RedRouter fallback combo (`parameters_basis: "lead"`) states its lead member's parameters, and
 * a response names the member that served it. While another member serves, a session plans for
 * that member's parameters instead: its context window, output limit, thinking levels, whether it
 * can think not at all, and whether it takes a forced tool choice. Once the lead serves again the
 * lead's apply. This is per-session memory only: the configuration and the recorded catalog
 * version never change, since falling back is per request.
 */

type Declared = {
  readonly router?: {
    readonly parameters?: ConfigProviderV1.RouterParameters
    readonly parameters_basis?: string
    readonly members?: ReadonlyArray<string>
    readonly member_parameters?: ReadonlyArray<ConfigProviderV1.RouterMemberParameters>
  }
}

type Serving = {
  readonly member: string
  /** The lead's parameters, which the saved limits were taken from. */
  readonly lead?: ConfigProviderV1.RouterParameters
  /** From the saved `member_parameters`; absent when the member had to be read from the router. */
  readonly parameters?: ConfigProviderV1.RouterParameters
  /** The connection the member is read from, keying `fetched`. */
  readonly connection: string
}

// Keyed by session, provider and combo id: the member serving each session's combo right now.
const serving = new Map<string, Serving>()
// Keyed by connection and member id: parameters read from `GET /models/<id>`, undefined when the
// router had none, so each member is read at most once.
const fetched = new Map<string, ConfigProviderV1.RouterParameters | undefined>()
const pending = new Map<string, Promise<void>>()

export type ObserveInput = {
  readonly sessionID: string
  readonly providerID: string
  readonly modelID: string
  /** The model the response reports serving it (`X-RedRouter-Served-Model`). */
  readonly servedModel: string | undefined
  /** The model's configuration, where discovery keeps what the router reported about it. */
  readonly declared: Declared | undefined
  readonly baseURL?: string
  readonly apiKey?: string
  readonly fetch?: typeof fetch
  readonly timeout?: number
}

/**
 * Records which member served a response for a session's combo. A member missing from the saved
 * `member_parameters` is read once from the router; until that answers, and when it has nothing,
 * the lead's parameters stay in use. A response that names no model changes nothing.
 */
export async function observe(input: ObserveInput) {
  const key = sessionKey(input.sessionID, input.providerID, input.modelID)
  const router = input.declared?.router
  const members = router?.members ?? []
  const served = input.servedModel
  if (router?.parameters_basis !== "lead" || !members.length) {
    serving.delete(key)
    return
  }
  if (!served) return
  const lead = members[0]
  if (!lead || sameModel(served, lead) || sameModel(served, input.modelID)) {
    serving.delete(key)
    return
  }
  const member = members.find((id) => sameModel(served, id)) ?? served
  const connection = `${input.providerID}\n${ProviderRouter.normalizeURL(input.baseURL ?? "") ?? ""}`
  const saved = router.member_parameters?.find((item) => item.id === member)?.parameters
  serving.set(key, { member, lead: router.parameters, parameters: saved, connection })
  if (saved || !input.baseURL) return
  await read(connection, member, { ...input, baseURL: input.baseURL })
}

/**
 * The router parameters that apply to a session's model: the serving member's while a member other
 * than the lead serves a lead-based combo, otherwise the ones discovery saved (`declared`).
 */
export function effectiveRouterParameters(
  sessionID: string,
  providerID: string,
  modelID: string,
  declared?: Declared,
): ConfigProviderV1.RouterParameters | undefined {
  return memberParameters(sessionID, providerID, modelID) ?? declared?.router?.parameters
}

/**
 * The model as a session should plan for it: while a combo member other than the lead serves, its
 * context window, output limit and thinking levels replace the lead's. A limit someone set by hand
 * (one that is not the lead's reported value) stays. Unchanged otherwise.
 */
export function model(sessionID: string, model: Provider.Model): Provider.Model {
  const state = serving.get(sessionKey(sessionID, model.providerID, model.id))
  const parameters = memberParameters(sessionID, model.providerID, model.id)
  if (!state || !parameters) return model
  return {
    ...model,
    limit: {
      ...model.limit,
      context: follow(model.limit.context, state.lead?.context_length, parameters.context_length),
      output: follow(model.limit.output, state.lead?.max_completion_tokens, parameters.max_completion_tokens),
    },
    variants: variants(model, parameters),
  }
}

/**
 * The variants a member takes: its thinking levels (the model's own settings for a level win over
 * generated ones, so configured overrides stay), without `none` when it cannot stop thinking.
 */
export function variants(model: Provider.Model, parameters: ConfigProviderV1.RouterParameters) {
  const levels =
    parameters.thinking_levels === undefined ? Object.keys(model.variants ?? {}) : (parameters.thinking_levels ?? [])
  const allowed = levels.filter((level) => level !== "none" || parameters.thinking_can_disable !== false)
  const generated = ProviderTransform.effortVariants(model, allowed)
  return Object.fromEntries(
    allowed.flatMap((level) => {
      const settings = model.variants?.[level] ?? generated[level]
      return settings ? [[level, settings] as const] : []
    }),
  )
}

/**
 * What clients are told about a lead-based combo's members: each member's variant names, so a
 * picker can follow the member a response reports serving. Undefined for any other model.
 */
export function memberVariants(model: Provider.Model, declared: Declared | undefined) {
  const router = declared?.router
  if (router?.parameters_basis !== "lead" || !router.member_parameters?.length) return
  return router.member_parameters.map((item) => ({
    id: item.id,
    variants: Object.keys(item.parameters ? variants(model, item.parameters) : (model.variants ?? {})),
  }))
}

/** Whether two model ids name the same model: routers may leave out the provider or upstream prefix. */
export function sameModel(a: string, b: string) {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

/** Forgets what served a session (all of them when no session is given), and what was read from routers. */
export function reset(sessionID?: string) {
  for (const key of serving.keys()) if (sessionID === undefined || key.startsWith(`${sessionID}\n`)) serving.delete(key)
  if (sessionID === undefined) fetched.clear()
}

function memberParameters(sessionID: string, providerID: string, modelID: string) {
  const state = serving.get(sessionKey(sessionID, providerID, modelID))
  if (!state) return
  return state.parameters ?? fetched.get(`${state.connection}\n${state.member}`)
}

function follow(current: number, lead: number | undefined, member: number | undefined) {
  if (member === undefined) return current
  if (lead !== undefined && current !== lead) return current
  return member
}

async function read(connection: string, member: string, input: ObserveInput & { readonly baseURL: string }) {
  const key = `${connection}\n${member}`
  if (fetched.has(key)) return
  const running = pending.get(key)
  if (running) return running
  const apiKey = input.apiKey?.trim()
  const path = member.split("/").map(encodeURIComponent).join("/")
  // Redirects are refused so the key never follows a hop to another address.
  const next = (input.fetch ?? fetch)(`${input.baseURL.trim().replace(/\/+$/, "")}/models/${path}`, {
    redirect: "error",
    signal: AbortSignal.timeout(input.timeout ?? ProviderRouter.TIMEOUT),
    headers: { accept: "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
  })
    .then((response) => (response.ok ? (response.json() as Promise<unknown>) : undefined))
    .catch(() => undefined)
    .then((body) => {
      fetched.set(key, ProviderDiscovery.routerParameters(isRecord(body) ? body.parameters : undefined))
    })
    .finally(() => pending.delete(key))
  pending.set(key, next)
  return next
}

function sessionKey(sessionID: string, providerID: string, modelID: string) {
  return `${sessionID}\n${providerID}\n${modelID}`
}

export * as ComboMember from "./combo-member"
