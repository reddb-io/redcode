import { afterAll, describe, expect } from "bun:test"
import { Effect, Option, Schedule } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Model } from "@opencode/core/model"
import { ModelLimit } from "@opencode/core/model-limit"
import { ModelsDev } from "@opencode/core/models-dev"
import { Plugin } from "@opencode/core/plugin"
import { catalogLimits, knownLimit } from "@opencode/core/plugin/provider/catalog-limits"
import { deriveProviderID } from "@opencode/core/plugin/provider/openai-compatible"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

// An endpoint that lists models the catalog knows (glm-5.3-flash, mimo-v2.6-pro) without describing them, one it
// describes itself, and one nobody knows.
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (request.headers.get("authorization") !== "Bearer sk-good") return new Response("no", { status: 401 })
    if (url.pathname === "/v1/models")
      return Response.json({
        data: [
          { id: "glm-5.3-flash" },
          { id: "mimo-v2.6-pro" },
          { id: "reported", context_length: 64_000, max_completion_tokens: 4_000 },
          { id: "nobody-knows-this-one" },
        ],
      })
    return new Response("missing", { status: 404 })
  },
})
afterAll(() => server.stop(true))

// The server runs the wizard inside a Location's services, on top of the application services: neither exports
// the models catalog service, so this graph is the one `prepare` really sees.
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)

const guess = ModelLimit.conservative(128_000)

describe("OpenAI-compatible endpoints where the server runs the wizard", () => {
  it.live("resolves a silent model's limits from the catalog at load instead of freezing a guess", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
      const baseURL = `${server.url.origin}/v1`
      const providerID = Provider.ID.make(deriveProviderID(baseURL))
      const catalog = catalogLimits(yield* ModelsDev.bundled)
      const expected = (id: string) => {
        const known = knownLimit(catalog, id)
        if (!known) throw new Error(`The bundled catalog no longer knows ${id}; pick another model for this test`)
        expect(known.context).not.toBe(guess)
        return known
      }
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
        // The wizard cannot read the catalog from where it runs; the limits must come from the load instead.
        expect(Option.isNone(yield* Effect.serviceOption(ModelsDev.Service))).toBe(true)
        const integrations = yield* Integration.Service
        yield* integrations.connection.key({
          integrationID: Integration.ID.make("openai-compatible"),
          key: "sk-good",
          answer: { baseURL },
        })
        const config = yield* Config.Service
        const models = yield* Model.Service
        const saved = yield* config.entries().pipe(
          Effect.map((entries) =>
            entries.flatMap((entry) =>
              entry.type === "document" && entry.info.providers?.[providerID] ? [entry.info.providers[providerID]] : [],
            ),
          ),
          Effect.filterOrFail((found) => found.length > 0),
          Effect.retry(Schedule.spaced("20 millis")),
          Effect.timeout("10 seconds"),
          Effect.map((found) => found[0]),
        )
        const loaded = (id: string) =>
          models.get(providerID, Model.ID.make(id)).pipe(
            Effect.filterOrFail((model) => model !== undefined),
            Effect.retry(Schedule.spaced("20 millis")),
            Effect.timeout("10 seconds"),
          )
        // Only what the endpoint reported is written; the rest is resolved from the current catalog on every load.
        expect(saved.models?.["reported"]?.limit).toEqual({ context: 64_000, output: 4_000 })
        expect(saved.models?.["glm-5.3-flash"]?.limit).toBeUndefined()
        expect(saved.models?.["mimo-v2.6-pro"]?.limit).toBeUndefined()
        expect(saved.models?.["nobody-knows-this-one"]?.limit).toBeUndefined()
        expect((yield* loaded("reported")).limit).toEqual({ context: 64_000, output: 4_000 })
        expect((yield* loaded("glm-5.3-flash")).limit).toEqual(expected("glm-5.3-flash"))
        expect((yield* loaded("mimo-v2.6-pro")).limit).toEqual(expected("mimo-v2.6-pro"))
        expect((yield* loaded("nobody-knows-this-one")).limit).toEqual({ context: guess, output: 8_192 })
      }).pipe(Effect.scoped, Effect.provide(LocationServiceMap.Service.get(ref)))
    }),
  )
})
