/**
 * Input limits learned from providers.
 *
 * The catalog says how large a model's context is; the provider behind a router or a corporate
 * proxy often enforces less, and a routed model nobody described gets a guessed limit. A request
 * refused for its size says what the limit really is, so that number is kept per provider and
 * model, and the loops size their requests by the smaller of the catalog's limit and the
 * provider's. The refusal also says how many tokens the provider counted, which calibrates the
 * character-based estimate for that model.
 */
export * as ModelLimit from "./model-limit"

import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import type { ContextOverflowNumbers } from "@reddb-io/redcode-llm"
import { Global } from "./global"
import { FSUtil } from "./fs-util"
import { makeGlobalNode } from "./effect/app-node"
import { serviceUse } from "./effect/service-use"

/** The estimate is never scaled below or above these: one refusal must not swing it wildly. */
export const RATIO_MIN = 0.5
export const RATIO_MAX = 3
/** Share of a guessed limit kept back, since a guess is as likely too large as too small. */
export const ESTIMATED_RESERVE = 0.1
const MESSAGE_MAX = 300
const FILE = "model-limits.json"

/** The limit a model's configuration declares, kept so a changed configuration wins over a lesson. */
export const Declared = Schema.Struct({
  context: Schema.optional(Schema.Number),
  input: Schema.optional(Schema.Number),
})
export type Declared = typeof Declared.Type

export const Observed = Schema.Struct({
  /** Input tokens the provider accepts in one request. */
  input: Schema.Number,
  /** Input tokens the provider counted for the refused request. */
  counted: Schema.optional(Schema.Number),
  /** Our estimate for that request. */
  estimated: Schema.optional(Schema.Number),
  /** `counted / estimated`, bounded; future estimates for the model are scaled by it. */
  ratio: Schema.optional(Schema.Number),
  /** Epoch milliseconds of the refusal. */
  at: Schema.Number,
  /** The provider's own sentence. */
  message: Schema.String,
  declared: Schema.optional(Declared),
})
export type Observed = typeof Observed.Type

export type Entry = { readonly providerID: string; readonly modelID: string; readonly observed: Observed }

const File = Schema.Struct({
  version: Schema.Number,
  models: Schema.Record(Schema.String, Observed),
})

export const key = (providerID: string, modelID: string) => `${providerID}/${modelID}`

export const ratio = (counted: number, estimated: number) =>
  estimated > 0 && counted > 0 ? Math.min(RATIO_MAX, Math.max(RATIO_MIN, counted / estimated)) : undefined

/**
 * What a refusal teaches. `output` is the completion the refused request asked for, which a
 * provider that counts input and output together has to be given back to find the input it takes.
 */
export const fromNumbers = (input: {
  readonly numbers: ContextOverflowNumbers
  readonly output: number
  readonly estimated?: number
  readonly declared?: Declared
  readonly message: string
  readonly at?: number
}): Observed | undefined => {
  const { numbers } = input
  if (numbers.limit === undefined) return undefined
  const output = numbers.output ?? input.output
  const limit = numbers.includesOutput ? numbers.limit - output : numbers.limit
  if (!(limit > 0)) return undefined
  const counted =
    numbers.counted === undefined
      ? undefined
      : numbers.includesOutput && numbers.output === undefined
        ? Math.max(0, numbers.counted - output)
        : numbers.counted
  const scale = counted !== undefined && input.estimated !== undefined ? ratio(counted, input.estimated) : undefined
  return {
    input: Math.floor(limit),
    ...(counted === undefined ? {} : { counted }),
    ...(input.estimated === undefined ? {} : { estimated: input.estimated }),
    ...(scale === undefined ? {} : { ratio: scale }),
    at: input.at ?? Date.now(),
    message: Array.from(input.message.trim()).slice(0, MESSAGE_MAX).join(""),
    ...(input.declared === undefined ? {} : { declared: input.declared }),
  }
}

/** Whether the configuration still declares what it did when the limit was learned. */
export const stillApplies = (observed: Observed, declared: Declared | undefined) =>
  (observed.declared?.context ?? null) === (declared?.context ?? null) &&
  (observed.declared?.input ?? null) === (declared?.input ?? null)

/** The input limit to size requests by: the catalog's, the provider's, whichever is smaller. */
export const effectiveInput = (limit: { readonly input?: number }, observed: Observed | undefined) => {
  const candidates = [limit.input, observed?.input].filter((value): value is number => value !== undefined && value > 0)
  return candidates.length ? Math.min(...candidates) : undefined
}

/** An estimate scaled by what the provider counted the last time it refused a request. */
export const calibrate = (estimate: number, observed: Observed | undefined) =>
  Math.ceil(estimate * (observed?.ratio ?? 1))

/** A guessed limit, held back by the reserve so a preflight over it errs on the safe side. */
export const conservative = (context: number) => Math.floor(context * (1 - ESTIMATED_RESERVE))

/** The text of a preflight refusal, with what to do about it. */
export const doomed = (input: { readonly providerID: string; readonly limit: number; readonly estimated: number }) =>
  `Request would exceed the ${input.providerID} limit of ${input.limit.toLocaleString("en-US")} input tokens (estimated ${input.estimated.toLocaleString("en-US")}); compaction could not reduce it below that. Raise limit.context for the model if the provider allows more, or start a new session.`

/** The notice shown once per session when a limit is learned. */
export const learnedNotice = (input: {
  readonly providerID: string
  readonly modelID: string
  readonly observed: Observed
}) => {
  const counted =
    input.observed.counted === undefined ? "" : `, counted ${input.observed.counted.toLocaleString("en-US")}`
  const estimated =
    input.observed.estimated === undefined ? "" : ` (estimated ${input.observed.estimated.toLocaleString("en-US")})`
  return `${input.providerID}/${input.modelID} accepts ${input.observed.input.toLocaleString("en-US")} input tokens${counted}${estimated}. Requests are sized to that from now on; set limit.context in config to override.`
}

export interface Interface {
  /** The lesson for a model, unless the configuration changed what it declares since. */
  readonly get: (providerID: string, modelID: string, declared?: Declared) => Effect.Effect<Observed | undefined>
  readonly learn: (providerID: string, modelID: string, observed: Observed) => Effect.Effect<void>
  readonly forget: (providerID: string, modelID: string) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Entry[]>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/ModelLimit") {}

export const use = serviceUse(Service)

const split = (item: string) => {
  const slash = item.indexOf("/")
  return slash === -1
    ? { providerID: item, modelID: "" }
    : { providerID: item.slice(0, slash), modelID: item.slice(slash + 1) }
}

const decodeFile = Schema.decodeUnknownEffect(File)

/** The store over a map, persisted through `save` after every change. */
const make = (models: Map<string, Observed>, save: (models: Map<string, Observed>) => Effect.Effect<void>) => {
  const forget = Effect.fn("ModelLimit.forget")(function* (providerID: string, modelID: string) {
    if (!models.delete(key(providerID, modelID))) return
    yield* save(models)
  })
  return Service.of({
    get: Effect.fn("ModelLimit.get")(function* (providerID: string, modelID: string, declared?: Declared) {
      const observed = models.get(key(providerID, modelID))
      if (!observed) return undefined
      if (stillApplies(observed, declared)) return observed
      // The person set or changed the model's limit after the lesson: their configuration wins.
      yield* forget(providerID, modelID)
      return undefined
    }),
    learn: Effect.fn("ModelLimit.learn")(function* (providerID: string, modelID: string, observed: Observed) {
      models.set(key(providerID, modelID), observed)
      yield* save(models)
    }),
    forget,
    list: () =>
      Effect.sync(() =>
        Array.from(models, ([item, observed]) => ({ ...split(item), observed })).sort((a, b) =>
          key(a.providerID, a.modelID).localeCompare(key(b.providerID, b.modelID)),
        ),
      ),
  })
}

/** A store that forgets everything with the process. */
export const memory = () => make(new Map(), () => Effect.void)

export const memoryLayer = () => Layer.succeed(Service, memory())

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const file = path.join(Global.Path.state, FILE)
    const models = new Map<string, Observed>()
    const loaded = yield* fs.readJson(file).pipe(
      Effect.flatMap(decodeFile),
      Effect.catch(() => Effect.succeed(undefined)),
    )
    for (const [item, observed] of Object.entries(loaded?.models ?? {})) models.set(item, observed)
    const save = (current: Map<string, Observed>) =>
      fs.ensureDir(Global.Path.state).pipe(
        Effect.andThen(fs.writeJson(file, { version: 1, models: Object.fromEntries(current) })),
        Effect.catch((error) => Effect.logWarning("could not save learned model limits", { file, error })),
      )
    return make(models, save)
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [FSUtil.node] })
