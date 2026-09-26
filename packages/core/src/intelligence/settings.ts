export * as IntelligenceSettings from "./settings.js"

import fs from "node:fs/promises"
import path from "node:path"
import { Intelligence } from "@opencode/schema/intelligence"
import { Integration } from "@opencode/schema/integration"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { Credential } from "../credential.js"
import { KV } from "../kv.js"
import { IntelligenceEvaluation } from "./evaluation.js"

const make = Effect.gen(function* () {
  const global = yield* Global.Service
  const credentials = yield* Credential.Service
  const kv = yield* KV.Service
  const lock = yield* Semaphore.make(1)
  const key = "redcode.intelligence.settings"
  const file = path.join(global.config, "intelligence.json")
  const legacy = [
    path.join(process.env.REDCODE_TEST_HOME ?? global.home, ".red", "code", "intelligence.json"),
    path.join(process.env.REDCODE_TEST_HOME ?? global.home, ".red", "redcode", "intelligence.json"),
  ]
  const readFile = (target: string) =>
    Effect.tryPromise({
      try: () =>
        fs.readFile(target, "utf8").catch((cause: NodeJS.ErrnoException) => {
          if (cause.code === "ENOENT" || cause.code === "ENOSYS") return undefined
          throw cause
        }),
      catch: () => new IntelligenceEvaluation.Error({ message: "Unable to read intelligence configuration" }),
    })

  const read = Effect.fn("IntelligenceSettings.read")(function* () {
    const saved = yield* kv.get(key)
    if (saved !== undefined)
      return yield* Schema.decodeUnknownEffect(Intelligence.Settings)(saved).pipe(
        Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Invalid intelligence configuration" })),
      )
    const current = yield* readFile(file)
    const content = current ?? (yield* Effect.forEach(legacy, readFile)).find((item) => item !== undefined)
    if (content === undefined) return IntelligenceEvaluation.defaults
    return yield* Schema.decodeUnknownEffect(
      Schema.UnknownFromJsonString.pipe(Schema.decodeTo(Intelligence.Settings)),
    )(content).pipe(
      Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Invalid intelligence configuration" })),
    )
  })

  const save = Effect.fn("IntelligenceSettings.save")(function* (input: Intelligence.Save) {
    const settings = yield* Schema.decodeUnknownEffect(Intelligence.Settings)(input.settings).pipe(
      Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Invalid intelligence settings" })),
    )
    if (settings.enabled && settings.reasoning !== "single" && (!settings.principal || !settings.evaluator))
      return yield* new IntelligenceEvaluation.Error({
        message: "Select a System Two principal and System One evaluator before enabling dual reasoning",
      })
    if (settings.evaluator && !validURL(settings.evaluator.baseURL))
      return yield* new IntelligenceEvaluation.Error({
        message: "Use an HTTP(S) base URL without credentials, query or fragment",
      })
    if (settings.principal && (!settings.principal.id.trim() || !settings.principal.providerID.trim()))
      return yield* new IntelligenceEvaluation.Error({ message: "Select a valid System Two model" })
    if (settings.principal && IntelligenceEvaluation.isJev(settings.principal.id))
      return yield* new IntelligenceEvaluation.Error({
        message: "Jev is an evaluator; select a generative System Two model",
      })
    const credential =
      input.apiKey && settings.evaluator
        ? yield* credentials.create({
            integrationID: Integration.ID.make(`intelligence:${settings.evaluator.transport}`),
            value: {
              type: "key",
              key: input.apiKey,
              metadata: {
                intelligenceTransport: settings.evaluator.transport,
                intelligenceBaseURL: new URL(settings.evaluator.baseURL).href.replace(/\/$/, ""),
              },
            },
            label: "System One",
          })
        : undefined
    const next = {
      ...settings,
      ...(settings.evaluator && credential
        ? { evaluator: { ...settings.evaluator, credentialID: credential.id } }
        : {}),
    }
    yield* kv.set(
      key,
      yield* Schema.decodeUnknownEffect(Schema.UnknownFromJsonString.pipe(Schema.decodeTo(Schema.Json)))(
        JSON.stringify(next),
      ).pipe(Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Invalid intelligence configuration" }))),
    )
    return next
  }, lock.withPermits(1))

  return { read, save }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/IntelligenceSettings") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Global.node, Credential.node, KV.node],
})

export function validURL(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && !url.search && !url.hash
}
