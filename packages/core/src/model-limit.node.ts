import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect, Layer, Schema, Semaphore } from "effect"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { ModelLimit } from "./model-limit.js"

const File = Schema.fromJsonString(Schema.Struct({
  version: Schema.Number,
  models: Schema.Record(Schema.String, ModelLimit.Observed),
}))

/** Lessons are read before each use and replaced atomically after local writes. */
export const fileStore = (file: string, legacy: readonly string[] = []) => Effect.gen(function* () {
  const lock = Semaphore.makeUnsafe(1)
  const load = Effect.gen(function* () {
    const text = yield* Effect.promise(async () => {
      const current = await readFile(file, "utf8").catch(() => undefined)
      if (current !== undefined) return current
      for (const source of legacy) {
        const previous = await readFile(source, "utf8").catch(() => undefined)
        if (previous !== undefined) return previous
      }
      return undefined
    })
    if (text === undefined) return new Map<string, ModelLimit.Observed>()
    const decoded = yield* Schema.decodeUnknownEffect(File)(text).pipe(
      Effect.catch((error) =>
        Effect.logWarning("learned model limits could not be read; starting over", { file, error }).pipe(
          Effect.as(undefined),
        ),
      ),
    )
    return new Map(Object.entries(decoded?.models ?? {}))
  })
  const write = (current: Map<string, ModelLimit.Observed>) =>
    Effect.tryPromise(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temporary, JSON.stringify({ version: 1, models: Object.fromEntries(current) }, null, 2))
      await rename(temporary, file)
    }).pipe(Effect.catch((error) => Effect.logWarning("could not save learned model limits", { file, error })))
  return ModelLimit.make({
    read: lock.withPermit(load),
    change: (apply) => lock.withPermit(Effect.gen(function* () {
      const models = yield* load
      apply(models)
      yield* write(models)
    })),
  })
})

export const layerAt = (file: string) => Layer.effect(ModelLimit.Service, fileStore(file))

export const defaultFileStore = () => fileStore(
  path.join(Global.Path.state, "model-limits.json"),
  [
    path.join(Global.Path.home, ".red", "code", "state", "model-limits.json"),
    path.join(Global.Path.home, ".red", "redcode", "state", "model-limits.json"),
  ],
)

export const modelLimitNode = makeGlobalNode({
  service: ModelLimit.Service,
  layer: Layer.effect(ModelLimit.Service, Effect.suspend(defaultFileStore)),
  deps: [],
})
