import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Npm } from "@opencode/util/npm"
import { Provider } from "../../provider.js"
import { loadSDKFactory } from "./sdk-factory.js"

export const SapAICorePlugin = define({
  id: "opencode.provider.sap.ai.core",
  effect: Effect.fn(function* (ctx) {
    const npm = yield* Npm.Service
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== Provider.ID.make("sap-ai-core")) return
        const serviceKey = typeof evt.options.serviceKey === "string" ? evt.options.serviceKey : undefined
        // Keep the legacy explicit service-key bridge; never select ambient service bindings.
        if (!evt.options.destination && !serviceKey)
          return yield* Effect.die(
            new Error("Configure an explicit SAP AI Core destination or serviceKey before using this provider"),
          )
        if (!evt.options.destination && serviceKey) process.env.AICORE_SERVICE_KEY = serviceKey

        const factory = yield* loadSDKFactory(npm, evt.package)
        if (typeof factory !== "function")
          return yield* Effect.die(new Error(`Package ${evt.package} provider factory export is not callable`))

        evt.sdk = factory(evt.options)
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== Provider.ID.make("sap-ai-core")) return
        evt.language = evt.sdk(evt.model.modelID ?? evt.model.id)
      }),
    )
  }),
})
