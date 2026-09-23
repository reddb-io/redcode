import { ProviderAuth } from "@/provider/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@reddb-io/redcode-core/models-dev"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"

import { mapValues } from "remeda"
import { Effect, Schema } from "effect"
import { HttpClient, HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  ProviderAuthApiError,
  ProviderConnectApiError,
  ProviderDiscoveryApiError,
  ProviderRemoveQuery,
} from "../groups/provider"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ProviderDiscovery } from "@/provider/discovery"
import { NineRouter } from "@/provider/nine-router"
import { RedRouter } from "@/provider/red-router"
import { OpenAICompatible } from "@/provider/openai-compatible"
import { ProviderRemove } from "@/provider/remove"
import { Credential } from "@reddb-io/redcode-core/credential"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { ModelLimit } from "@reddb-io/redcode-core/model-limit"
import { InstanceStore } from "@/project/instance-store"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { InstanceState } from "@/effect/instance-state"
import { ConfigPaths } from "@/config/paths"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import path from "path"

const CONFIG_FILE_NAMES = [
  "opencode.json",
  "opencode.jsonc",
  "redcode.json",
  "redcode.jsonc",
  "config.json",
  "config.jsonc",
]

function mapProviderAuthError<A, R>(self: Effect.Effect<A, ProviderAuth.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof ProviderAuth.OauthMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCodeMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCallbackFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: {} })
      }
      if (error instanceof ProviderAuth.ValidationFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: { field: error.field, message: error.message } })
      }
      return new ProviderAuthApiError({ name: "BadRequest", data: {} })
    }),
  )
}

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service
    const authStore = yield* Auth.Service
    const http = yield* HttpClient.HttpClient
    const credentials = yield* Credential.Service
    const intelligence = yield* Intelligence.Service
    const limits = yield* ModelLimit.Service

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      const config = yield* cfg.get()
      const all = yield* ModelsDev.Service.use((s) => s.get())
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
      const filtered: Record<string, (typeof all)[string]> = {}
      for (const [key, value] of Object.entries(all)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) filtered[key] = value
      }
      const connected = yield* provider.list()
      const credentials = yield* authStore.all().pipe(Effect.orDie)
      const providers = Object.assign(
        mapValues(filtered, (item) => Provider.fromModelsDevProvider(item)),
        connected,
      )
      return {
        all: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
        connected: Object.keys(providers).filter((id) => id in connected || credentials[id]),
      }
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      return yield* mapProviderAuthError(
        svc.authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          inputs: ctx.payload.inputs,
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
        Effect.mapError(() => new ProviderAuthApiError({ name: "BadRequest", data: {} })),
      )
      // Match legacy route behavior: when authorize() resolves without a
      // result (e.g. no further redirect), serialize as JSON `null` instead
      // of an empty body so clients can `.json()` parse the response.
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* mapProviderAuthError(
        svc.callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          code: ctx.payload.code,
        }),
      )
      yield* ProviderRemove.enable(cfg, ctx.params.providerID)
      return true
    })

    const discover = Effect.fn("ProviderHttpApi.discover")(function* (ctx: {
      payload: typeof ProviderDiscovery.Input.Type
    }) {
      const catalog = ProviderDiscovery.catalogLimits(yield* ModelsDev.Service.use((s) => s.get()))
      return yield* ProviderDiscovery.discover(http, ctx.payload, { catalog }).pipe(
        Effect.mapError((error) => new ProviderDiscoveryApiError({ message: error.message })),
      )
    })

    // Global configuration and a credential changed. Reload every instance once, before the
    // response is sent, so the client's next reads already include the connection.
    const reloadBeforeResponse = Effect.fn("ProviderHttpApi.reloadBeforeResponse")(function* () {
      const store = yield* InstanceStore.Service
      yield* HttpEffect.appendPreResponseHandler((_request, response) =>
        disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }).pipe(
          Effect.provideService(InstanceStore.Service, store),
          Effect.uninterruptible,
          Effect.as(response),
        ),
      )
    })

    const connectOpenAICompatible = Effect.fn("ProviderHttpApi.connectOpenAICompatible")(function* (ctx: {
      payload: OpenAICompatible.Input
    }) {
      const models = yield* ModelsDev.Service.use((s) => s.get())
      // Without a live or cached catalog (offline), fall back to the ids bundled into the build.
      const builtInIDs = new Set(Object.keys(models).length ? Object.keys(models) : ModelsDev.snapshotProviderIDs())
      const result = yield* OpenAICompatible.connect(
        {
          http,
          config: cfg,
          auth: authStore,
          catalog: ProviderDiscovery.catalogLimits(models),
          builtIn: (id) => builtInIDs.has(id),
        },
        ctx.payload,
      ).pipe(Effect.mapError((error) => new ProviderConnectApiError({ reason: error.reason, message: error.message })))
      yield* reloadBeforeResponse()
      if (!result.movedFrom) return result
      const projectReferences = yield* referencingFiles(result.movedFrom, result.configPath)
      return projectReferences.length ? { ...result, projectReferences } : result
    })

    /** Configuration files besides the written global file that mention a provider id. They are listed, not edited. */
    const referencingFiles = Effect.fn("ProviderHttpApi.referencingFiles")(
      function* (providerID: string, written: string) {
        const ctx = yield* InstanceState.context
        const fsUtil = yield* FSUtil.Service
        const candidates = [
          ...(yield* ConfigPaths.files(["redcode", "opencode"], ctx.directory, ctx.worktree)),
          ...(yield* ConfigPaths.directories(ctx.directory, ctx.worktree)).flatMap((dir) =>
            CONFIG_FILE_NAMES.map((name) => path.join(dir, name)),
          ),
        ]
        const mention = new RegExp(`"${providerID}["/]`)
        const found: string[] = []
        for (const file of new Set(candidates)) {
          if (path.resolve(file) === path.resolve(written)) continue
          const text = yield* fsUtil.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
          if (text && mention.test(text)) found.push(file)
        }
        return found
      },
      Effect.orElseSucceed((): string[] => []),
    )

    const remove = Effect.fn("ProviderHttpApi.remove")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      query: typeof ProviderRemoveQuery.Type
    }) {
      const models = yield* ModelsDev.Service.use((s) => s.get())
      const result = yield* ProviderRemove.remove(
        {
          config: cfg,
          auth: authStore,
          credentials,
          intelligence,
          limits,
          envNames: models[ctx.params.providerID]?.env,
        },
        ctx.params.providerID,
        { dryRun: ctx.query.dryRun },
      )
      if (!result.dryRun) yield* reloadBeforeResponse()
      return { ...result, referencingFiles: yield* referencingFiles(ctx.params.providerID, result.configPath) }
    })

    const connectNineRouter = Effect.fn("ProviderHttpApi.connectNineRouter")(function* (ctx: {
      payload: typeof ProviderDiscovery.Input.Type
    }) {
      const catalog = ProviderDiscovery.catalogLimits(yield* ModelsDev.Service.use((s) => s.get()))
      const result = yield* NineRouter.connect({ http, config: cfg, auth: authStore, catalog }, ctx.payload).pipe(
        Effect.mapError((error) => new ProviderDiscoveryApiError({ message: error.message })),
      )
      yield* reloadBeforeResponse()
      return result
    })

    const connectRedRouter = Effect.fn("ProviderHttpApi.connectRedRouter")(function* (ctx: {
      payload: typeof ProviderDiscovery.Input.Type
    }) {
      const catalog = ProviderDiscovery.catalogLimits(yield* ModelsDev.Service.use((s) => s.get()))
      const result = yield* RedRouter.connect({ http, config: cfg, auth: authStore, catalog }, ctx.payload).pipe(
        Effect.mapError((error) => new ProviderDiscoveryApiError({ message: error.message })),
      )
      yield* reloadBeforeResponse()
      return result
    })

    return handlers
      .handle("discover", discover)
      .handle("connectOpenAICompatible", connectOpenAICompatible)
      .handle("connectNineRouter", connectNineRouter)
      .handle("connectRedRouter", connectRedRouter)
      .handle("remove", remove)
      .handle("list", list)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
  }),
)
