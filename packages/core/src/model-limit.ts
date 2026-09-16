/**
 * Input limits learned from providers.
 *
 * The catalog says how large a model's context is; the provider behind a router or a corporate
 * proxy often enforces less, and a routed model nobody described gets a guessed limit. A request
 * refused for its size says what the limit really is, so that number is kept per provider and
 * model, and the loops size their requests by the smaller of the catalog's limit and the
 * provider's. The refusal also says how many tokens the provider counted, which calibrates the
 * character-based estimate for that model; a request the provider later accepts above the lesson
 * raises it.
 */
export * as ModelLimit from "./model-limit"

import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import * as NFS from "fs/promises"
import path from "path"
import type { ContextOverflowNumbers } from "@reddb-io/redcode-llm"
import { Global } from "./global"
import { makeGlobalNode } from "./effect/app-node"
import { serviceUse } from "./effect/service-use"

/** The estimate is never scaled below or above these: one refusal must not swing it wildly. */
export const RATIO_MIN = 0.5
export const RATIO_MAX = 1.5
/** Share of a guessed limit kept back, since a guess is as likely too large as too small. */
export const ESTIMATED_RESERVE = 0.1
/** No model accepts less than this; a smaller number is not a context limit. */
export const LIMIT_FLOOR = 4_096
/** Nor less than this share of what the configuration declares for the model. */
export const LIMIT_SHARE = 0.25
const MESSAGE_MAX = 300
const FILE = "model-limits.json"

/** The limit a model's configuration declares, kept so a changed configuration wins over a lesson. */
export const Declared = Schema.Struct({
  context: Schema.optional(Schema.Number),
  input: Schema.optional(Schema.Number),
})
export type Declared = typeof Declared.Type

export const Observed = Schema.Struct({
  /** Tokens the provider enforces in one request, as it said. */
  limit: Schema.Number,
  /** Whether that limit counts the completion the request asks for together with the input. */
  includesOutput: Schema.optional(Schema.Boolean),
  /** Input tokens the provider counted for the refused request. */
  counted: Schema.optional(Schema.Number),
  /** Our estimate for that request. */
  estimated: Schema.optional(Schema.Number),
  /** `counted / estimated`, bounded; what history gains between requests is scaled by it. */
  ratio: Schema.optional(Schema.Number),
  /** Epoch milliseconds of the refusal, or of the acceptance that raised the lesson. */
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
 * Input tokens the provider accepts, given the completion a request asks for now. Kept apart from
 * the lesson so a changed `limit.output` does not leave a stale input limit behind.
 */
export const inputOf = (observed: Observed, output: number) =>
  observed.includesOutput ? Math.max(0, observed.limit - output) : observed.limit

/**
 * What a refusal teaches, or nothing when the numbers do not describe one: a limit no model has
 * (below the floor, or a quarter of what the configuration declares), or a count that does not
 * exceed it. Both keep a sentence about images, tools or unrelated arithmetic from becoming a
 * limit that refuses every later request.
 *
 * `output` is the completion the refused request asked for, which a provider that counts input
 * and output together has to be given back to find the input it takes.
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
  const includesOutput = numbers.includesOutput === true
  const output = numbers.output ?? input.output
  const accepts = includesOutput ? numbers.limit - output : numbers.limit
  if (!(accepts >= LIMIT_FLOOR)) return undefined
  const declared = input.declared?.input ?? input.declared?.context
  if (declared !== undefined && declared > 0 && accepts < declared * LIMIT_SHARE) return undefined
  // The count is normalised to input tokens; the comparison stays on the provider's own terms.
  const counted =
    numbers.counted === undefined
      ? undefined
      : includesOutput && numbers.output === undefined
        ? Math.max(0, numbers.counted - output)
        : numbers.counted
  const total =
    numbers.counted === undefined
      ? undefined
      : includesOutput && numbers.output !== undefined
        ? numbers.counted + numbers.output
        : numbers.counted
  if (total !== undefined && total <= numbers.limit) return undefined
  const scale = counted !== undefined && input.estimated !== undefined ? ratio(counted, input.estimated) : undefined
  return {
    limit: Math.floor(numbers.limit),
    ...(includesOutput ? { includesOutput } : {}),
    ...(counted === undefined ? {} : { counted }),
    ...(input.estimated === undefined ? {} : { estimated: input.estimated }),
    ...(scale === undefined ? {} : { ratio: scale }),
    at: input.at ?? Date.now(),
    message: Array.from(input.message.trim()).slice(0, MESSAGE_MAX).join(""),
    ...(input.declared === undefined ? {} : { declared: input.declared }),
  }
}

/**
 * The lesson raised by a request the provider accepted above it: the provider has shown it takes
 * at least `accepted` input tokens with `output` tokens of completion asked for.
 */
export const raised = (observed: Observed, accepted: number, output: number, at = Date.now()): Observed | undefined => {
  if (!(accepted > inputOf(observed, output))) return undefined
  return { ...observed, limit: observed.includesOutput ? accepted + output : accepted, at }
}

/** Whether the configuration still declares what it did when the limit was learned. */
export const stillApplies = (observed: Observed, declared: Declared | undefined) =>
  (observed.declared?.context ?? null) === (declared?.context ?? null) &&
  (observed.declared?.input ?? null) === (declared?.input ?? null)

/** The input limit to size requests by: the catalog's, the provider's, whichever is smaller. */
export const effectiveInput = (limit: { readonly input?: number }, observed: Observed | undefined, output: number) => {
  const candidates = [limit.input, observed === undefined ? undefined : inputOf(observed, output)].filter(
    (value): value is number => value !== undefined && value > 0,
  )
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
  readonly output: number
}) => {
  const counted =
    input.observed.counted === undefined ? "" : `, counted ${input.observed.counted.toLocaleString("en-US")}`
  const estimated =
    input.observed.estimated === undefined ? "" : ` (estimated ${input.observed.estimated.toLocaleString("en-US")})`
  return `${input.providerID}/${input.modelID} accepts ${inputOf(input.observed, input.output).toLocaleString("en-US")} input tokens${counted}${estimated}. Requests are sized to that from now on; set limit.context in config to override.`
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

type Models = Map<string, Observed>

/** Where the lessons live: read before every use, and read again before every change. */
type Backing = {
  /** The current lessons, fresh from wherever they are kept. */
  readonly read: Effect.Effect<Models>
  /** Applies one change to the freshest lessons and keeps the result. */
  readonly change: (apply: (models: Models) => void) => Effect.Effect<void>
}

const make = (backing: Backing) => {
  const forget = Effect.fn("ModelLimit.forget")(function* (providerID: string, modelID: string) {
    yield* backing.change((models) => {
      models.delete(key(providerID, modelID))
    })
  })
  return Service.of({
    get: Effect.fn("ModelLimit.get")(function* (providerID: string, modelID: string, declared?: Declared) {
      const observed = (yield* backing.read).get(key(providerID, modelID))
      if (!observed) return undefined
      if (stillApplies(observed, declared)) return observed
      // The person set or changed the model's limit after the lesson: their configuration wins.
      yield* forget(providerID, modelID)
      return undefined
    }),
    learn: Effect.fn("ModelLimit.learn")(function* (providerID: string, modelID: string, observed: Observed) {
      yield* backing.change((models) => {
        models.set(key(providerID, modelID), observed)
      })
    }),
    forget,
    list: () =>
      backing.read.pipe(
        Effect.map((models) =>
          Array.from(models, ([item, observed]) => ({ ...split(item), observed })).sort((a, b) =>
            key(a.providerID, a.modelID).localeCompare(key(b.providerID, b.modelID)),
          ),
        ),
      ),
  })
}

/** A store that forgets everything with the process. */
export const memory = () => {
  const models: Models = new Map()
  return make({
    read: Effect.succeed(models),
    change: (apply) => Effect.sync(() => apply(models)),
  })
}

export const memoryLayer = () => Layer.succeed(Service, memory())

/**
 * The lessons in a JSON file shared by every Redcode process on the machine. The file is small and
 * read once per provider request, so it is read whole before every use and before every change,
 * and two processes never undo each other's lessons; a change is written to a temporary file and
 * renamed into place, so a crash mid-write leaves the previous file intact.
 */
export const fileStore = (file: string) =>
  Effect.gen(function* () {
    const lock = Semaphore.makeUnsafe(1)
    const load = Effect.gen(function* () {
      const text = yield* Effect.tryPromise(() => NFS.readFile(file, "utf8")).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (text === undefined) return new Map() as Models
      const decoded = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: (error) => error }).pipe(
        Effect.flatMap(decodeFile),
        Effect.catch((error) =>
          Effect.logWarning("learned model limits could not be read; starting over", { file, error }).pipe(
            Effect.as(undefined),
          ),
        ),
      )
      return new Map(Object.entries(decoded?.models ?? {})) as Models
    })
    const write = (current: Models) =>
      Effect.tryPromise(async () => {
        await NFS.mkdir(path.dirname(file), { recursive: true })
        const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
        await NFS.writeFile(temporary, JSON.stringify({ version: 1, models: Object.fromEntries(current) }, null, 2))
        await NFS.rename(temporary, file)
      }).pipe(Effect.catch((error) => Effect.logWarning("could not save learned model limits", { file, error })))
    return make({
      read: lock.withPermit(load),
      change: (apply) =>
        lock.withPermit(
          Effect.gen(function* () {
            // Read again: another process may have learned or forgotten something meanwhile.
            const models = yield* load
            apply(models)
            yield* write(models)
          }),
        ),
    })
  })

export const layerAt = (file: string) => Layer.effect(Service, fileStore(file))

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(
    Service,
    Effect.suspend(() => fileStore(path.join(Global.Path.state, FILE))),
  ),
  deps: [],
})
