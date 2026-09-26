export * as ProviderRemove from "./provider-removal.js"

import { ProviderRemoval } from "@opencode/schema/provider-removal"
import { IntegrationID } from "@opencode/schema/integration-id"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { Config } from "./config.js"
import { ConfigProviderRemove } from "./config/provider-remove.js"
import { Credential } from "./credential.js"
import { Integration } from "./integration.js"
import { IntelligenceSettings } from "./intelligence/settings.js"
import { IntelligenceRouter } from "./intelligence/router.js"
import { ModelLimit } from "./model-limit.js"
import { modelLimitNode } from "#model-limit-node"

export interface Interface {
  readonly remove: (providerID: string, options?: { dryRun?: boolean }) => Effect.Effect<ProviderRemoval.Result, Error>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/ProviderRemoval") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const credentials = yield* Credential.Service
    const integrations = yield* Integration.Service
    const intelligence = yield* IntelligenceSettings.Service
    const limits = yield* ModelLimit.Service

    const remove = Effect.fn("ProviderRemoval.remove")(function* (
      providerID: string,
      options: { dryRun?: boolean } = {},
    ) {
      const removeConfig = config.removeProvider
      if (!removeConfig) return yield* Effect.fail(new Error("Global configuration updates are unavailable"))
      const entries = yield* config.entries()
      const integration = yield* integrations.get(IntegrationID.make(providerID))
      const saved = (yield* credentials.all()).filter((credential) => credential.integrationID === providerID)
      const envVariables = [
        ...new Set([
          ...(integration?.methods.flatMap((method) => method.type === "env" ? method.names : []) ?? []),
          ...entries.flatMap((entry) => entry.type === "document" ? entry.info.providers?.[providerID]?.env ?? [] : []),
        ].filter((name) => Boolean(process.env[name]))),
      ]
      const preview = yield* removeConfig(providerID, { hide: envVariables.length > 0, dryRun: true })
      const referencingFiles = entries.flatMap((entry) => {
        if (entry.type !== "document" || !entry.path || entry.path === preview.path) return []
        const plan = ConfigProviderRemove.plan(entry.info, providerID, false)
        return plan.configured || plan.references.length ? [entry.path] : []
      })
      const settings = yield* intelligence.read()
      const evaluator = settings.evaluator
      const evaluatorCredential = evaluator?.credentialID ? yield* credentials.get(evaluator.credentialID) : undefined
      const endpoint = entries
        .filter((entry) => entry.type === "document")
        .flatMap((entry) => {
          const url = entry.info.providers?.[providerID]?.settings?.baseURL
          return typeof url === "string" ? [url] : []
        })
        .at(-1) ?? saved.flatMap((credential) => {
          const url = credential.value.metadata?.baseURL
          return typeof url === "string" ? [url] : []
        }).at(-1)
      const principalUses = settings.principal?.providerID === providerID
      const evaluatorUses = Boolean(evaluator && (
        saved.some((credential) => credential.id === evaluator.credentialID) ||
        (evaluatorCredential?.integrationID !== `intelligence:${evaluator.transport}` &&
          endpoint && sameEndpoint(evaluator.baseURL, endpoint))
      ))
      const next = {
        ...settings,
        ...(principalUses ? { principal: undefined } : {}),
        ...(evaluatorUses ? { evaluator: undefined } : {}),
        ...((principalUses || evaluatorUses) && settings.reasoning === "dual" ? { enabled: false } : {}),
      }
      const learned = (yield* limits.list()).filter((entry) => entry.providerID === providerID)
      const result = {
        providerID,
        dryRun: options.dryRun === true,
        removed: {
          credentials: saved.length,
          config: preview.configured,
          references: [
            ...preview.references,
            ...(principalUses ? ["System Two principal"] : []),
            ...(evaluatorUses ? ["System One evaluator"] : []),
          ],
          learnedLimits: learned.length,
          hidden: preview.hidden,
        },
        configPath: preview.path,
        referencingFiles: [...new Set(referencingFiles)],
        envVariables,
      } satisfies ProviderRemoval.Result
      if (options.dryRun) return result

      yield* Effect.uninterruptible(Effect.gen(function* () {
        yield* removeConfig(providerID, { hide: envVariables.length > 0 })
        yield* Effect.forEach(saved, (credential) => credentials.remove(credential.id), { discard: true })
        if (principalUses || evaluatorUses) yield* intelligence.save({ settings: next })
        yield* Effect.forEach(learned, (entry) => limits.forget(entry.providerID, entry.modelID), { discard: true })
      }))
      IntelligenceRouter.clearCache()
      return result
    })

    return Service.of({ remove })
  }),
)

function sameEndpoint(left: string, right: string) {
  if (!URL.canParse(left) || !URL.canParse(right)) return false
  return new URL(left).href.replace(/\/+$/, "") === new URL(right).href.replace(/\/+$/, "")
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, Credential.node, Integration.node, IntelligenceSettings.node, modelLimitNode],
})
