import { Effect, Schema } from "effect"
import type { Auth } from "@/auth"
import type { Config } from "@/config/config"
import { isRecord } from "@/util/record"
import { Credential } from "@reddb-io/redcode-core/credential"
import type { Intelligence } from "@reddb-io/redcode-core/intelligence"
import type { ModelLimit } from "@reddb-io/redcode-core/model-limit"
import { ProviderRouter } from "@reddb-io/redcode-core/provider/router"

export const Result = Schema.Struct({
  providerID: Schema.String,
  dryRun: Schema.Boolean.annotate({ description: "True when nothing was changed and the result only describes it." }),
  removed: Schema.Struct({
    credential: Schema.Boolean.annotate({ description: "A saved key or login for the provider." }),
    config: Schema.Boolean.annotate({ description: "The provider's entry in the global configuration file." }),
    references: Schema.Array(Schema.String).annotate({
      description:
        "Settings that pointed at the provider and are cleared, for example default model, agent build or S2 principal.",
    }),
    learnedLimits: Schema.Finite.annotate({ description: "Learned model input limits that are forgotten." }),
    hidden: Schema.Boolean.annotate({
      description:
        "True when the provider is also added to disabled_providers because envVariables would load it again. Connecting it again shows it.",
    }),
  }),
  configPath: Schema.String.annotate({ description: "The global configuration file." }),
  referencingFiles: Schema.Array(Schema.String).annotate({
    description: "Project configuration files that still mention the provider. They are not edited.",
  }),
  envVariables: Schema.Array(Schema.String).annotate({
    description:
      "Environment variables set on the Redcode server that would load the provider again, which is why it is hidden.",
  }),
})
export type Result = typeof Result.Type

/**
 * Removes a provider completely: its saved credential, its entry in the global configuration,
 * every global setting that names it (default, small, agent and command models, the enabled and
 * disabled provider lists), System Two models and a System One evaluator that use it, cached
 * router detections and catalog versions, and learned model limits. A provider the environment
 * would load again is hidden through `disabled_providers` so the removal sticks; connecting it
 * again takes it off that list. With `dryRun` nothing is changed and the result lists what would
 * be. Project configuration files are never edited; the caller lists them.
 */
export const remove = Effect.fn("ProviderRemove.remove")(function* (
  deps: {
    config: Config.Interface
    auth: Auth.Interface
    credentials: Pick<Credential.Interface, "get">
    intelligence: Pick<Intelligence.Interface, "read" | "save">
    limits: Pick<ModelLimit.Interface, "list" | "forget">
    /** Environment variables that load the provider with nothing saved for it (`Provider.ambientEnv`). */
    envNames?: ReadonlyArray<string>
    env?: (name: string) => string | undefined
  },
  providerID: string,
  options: { dryRun?: boolean } = {},
) {
  const env = deps.env ?? ((name: string) => process.env[name])
  const file = yield* deps.config.readGlobalFile()
  const entry = record(record(file.data.provider)[providerID])
  const saved = yield* deps.auth.get(providerID).pipe(Effect.orDie)
  const baseURL =
    stringValue(record(entry.options).baseURL) ??
    (saved?.type === "api" ? stringValue(saved.metadata?.baseURL) : undefined)
  const envVariables = (deps.envNames ?? []).filter((name) => env(name))
  const config = configChanges(file.data, providerID, envVariables.length > 0)
  const settings = yield* deps.intelligence.read().pipe(Effect.orElseSucceed(() => undefined))
  const reasoning = settings
    ? yield* intelligenceChanges(settings, providerID, baseURL, deps.credentials)
    : { labels: [], next: undefined }
  const limits = (yield* deps.limits.list()).filter((item) => item.providerID === providerID)

  const result = {
    providerID,
    dryRun: options.dryRun === true,
    removed: {
      credential: saved !== undefined,
      config: Object.hasOwn(record(file.data.provider), providerID),
      references: [...config.labels, ...reasoning.labels],
      learnedLimits: limits.length,
      hidden: envVariables.length > 0,
    },
    configPath: file.path,
    referencingFiles: [] as string[],
    envVariables,
  } satisfies Result
  if (options.dryRun) return result

  yield* Effect.uninterruptible(
    Effect.gen(function* () {
      if (result.removed.config || config.labels.length || config.hides)
        yield* deps.config.updateGlobal(config.patch as Parameters<Config.Interface["updateGlobal"]>[0], {
          remove: [...(result.removed.config ? [["provider", providerID]] : []), ...config.remove],
        })
      yield* deps.auth.remove(providerID).pipe(Effect.orDie)
      if (reasoning.next)
        yield* deps.intelligence
          .save({ settings: reasoning.next })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("could not clear the removed provider from reasoning settings", { error }),
            ),
          )
      yield* Effect.forEach(limits, (item) => deps.limits.forget(item.providerID, item.modelID), { discard: true })
    }),
  )
  if (baseURL) ProviderRouter.forget(baseURL)
  ProviderRouter.forgetCatalogs(providerID)
  return result
})

/**
 * Takes a provider off `disabled_providers` in the global configuration, so connecting it again
 * after it was hidden makes it visible. Does nothing when it is not listed.
 */
export const enable = Effect.fn("ProviderRemove.enable")(function* (config: Config.Interface, providerID: string) {
  const file = yield* config.readGlobalFile()
  const change = enabling(file.data, providerID)
  if (!change) return
  yield* config.updateGlobal(change.patch as Parameters<Config.Interface["updateGlobal"]>[0], {
    remove: change.remove,
  })
})

/** The change that takes a provider off `disabled_providers`, or undefined when it is not listed. */
export function enabling(data: Record<string, unknown>, providerID: string) {
  const list = data.disabled_providers
  if (!Array.isArray(list) || !list.includes(providerID)) return
  const next = list.filter((item) => item !== providerID)
  return next.length
    ? { patch: { disabled_providers: next }, remove: [] as string[][] }
    : { patch: {}, remove: [["disabled_providers"]] }
}

/**
 * The global settings that name a provider, and the change that clears them: default and small
 * models, agent and command models are removed (they fall back to their defaults), and the id
 * leaves the enabled provider list. A list left empty is removed, since an empty
 * `enabled_providers` would hide every provider. With `hide` the id joins `disabled_providers`
 * (`hides` says whether that is a change); otherwise it leaves that list too.
 */
export function configChanges(data: Record<string, unknown>, providerID: string, hide = false) {
  const uses = (value: unknown) => typeof value === "string" && value.startsWith(`${providerID}/`)
  const labels: string[] = []
  const remove: string[][] = []
  const patch: Record<string, unknown> = {}
  for (const [key, label] of [
    ["model", "default model"],
    ["small_model", "small model"],
  ] as const) {
    if (!uses(data[key])) continue
    labels.push(label)
    remove.push([key])
  }
  for (const key of ["agent", "command"] as const) {
    for (const [name, entry] of Object.entries(record(data[key]))) {
      if (!uses(record(entry).model)) continue
      labels.push(`${key} ${name}`)
      remove.push([key, name, "model"])
    }
  }
  for (const [key, label] of [
    ["enabled_providers", "enabled providers"],
    ["disabled_providers", "disabled providers"],
  ] as const) {
    const list = data[key]
    if (!Array.isArray(list) || !list.includes(providerID)) continue
    if (hide && key === "disabled_providers") continue
    labels.push(label)
    const next = list.filter((item) => item !== providerID)
    if (next.length) patch[key] = next
    else remove.push([key])
  }
  const disabled = Array.isArray(data.disabled_providers) ? data.disabled_providers : []
  const hides = hide && !disabled.includes(providerID)
  if (hides) patch.disabled_providers = [...disabled, providerID]
  return { labels, patch, remove, hides }
}

type Settings = Effect.Success<ReturnType<Intelligence.Interface["read"]>>

/**
 * Clears System Two models on the provider and a System One evaluator that uses it: through the
 * provider's saved key, or at the provider's address without a key of its own. When dual
 * reasoning was on and lost a model it needs, it is turned off until it is set up again.
 */
const intelligenceChanges = Effect.fn("ProviderRemove.intelligenceChanges")(function* (
  settings: Settings,
  providerID: string,
  baseURL: string | undefined,
  credentials: Pick<Credential.Interface, "get">,
) {
  const evaluator = settings.evaluator
  const credential = evaluator?.credentialID
    ? yield* credentials.get(Credential.ID.make(evaluator.credentialID))
    : undefined
  const ownKey = credential?.integrationID.startsWith("intelligence:") ?? false
  const evaluatorUses =
    evaluator !== undefined &&
    (credential?.integrationID === providerID || (!ownKey && ProviderRouter.sameEndpoint(evaluator.baseURL, baseURL)))
  const principal = settings.principal?.providerID === providerID
  const fast = settings.fast?.providerID === providerID
  if (!principal && !fast && !evaluatorUses) return { labels: [], next: undefined }
  const { principal: _principal, fast: _fast, evaluator: _evaluator, ...rest } = settings
  const next = {
    ...rest,
    ...(principal ? {} : settings.principal ? { principal: settings.principal } : {}),
    ...(fast ? {} : settings.fast ? { fast: settings.fast } : {}),
    ...(evaluatorUses ? {} : evaluator ? { evaluator } : {}),
  }
  const turnedOff = next.enabled && next.reasoning !== "single" && (!next.principal || !next.evaluator)
  return {
    labels: [
      ...(principal ? ["S2 principal"] : []),
      ...(fast ? ["S2 fast model"] : []),
      ...(evaluatorUses ? ["S1 evaluator"] : []),
      ...(turnedOff ? ["dual reasoning (turned off until set up again in /setup)"] : []),
    ],
    next: turnedOff ? { ...next, enabled: false } : next,
  }
})

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

export * as ProviderRemove from "./remove"
