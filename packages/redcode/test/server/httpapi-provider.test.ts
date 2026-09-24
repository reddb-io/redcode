import { describe, expect } from "bun:test"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { Context, Effect, Layer } from "effect"
import { NodeHttpServer } from "@effect/platform-node"
import Http from "node:http"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import path from "path"
import fs from "fs/promises"
import { Global } from "@reddb-io/redcode-core/global"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { markPluginDependenciesReady } from "../fixture/plugin"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const testStateLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.promise(() => resetDatabase()),
    () => Effect.promise(() => resetDatabase()),
  ),
)

const it = testEffect(Layer.mergeAll(testStateLayer, LayerNode.compile(FSUtil.node), httpApiLayer))
const projectOptions = { config: { formatter: false, lsp: false } }
const providerID = "test-oauth-parity"
const oauthURL = "https://example.com/oauth"
const oauthInstructions = "Finish OAuth"

function providerListHasFetch(list: unknown) {
  if (!Array.isArray(list)) return false
  return list.some((item: unknown) => {
    if (typeof item !== "object" || item === null || !("id" in item) || !("options" in item)) return false
    if (item.id !== "google") return false
    if (typeof item.options !== "object" || item.options === null) return false
    return "fetch" in item.options
  })
}

function hasProviderWithFetch(input: unknown, key: "all" | "providers") {
  if (typeof input !== "object" || input === null) return false
  if (key === "all") return "all" in input && providerListHasFetch(input.all)
  return "providers" in input && providerListHasFetch(input.providers)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function providerList(input: unknown, key: "all" | "providers") {
  if (!isRecord(input)) return []
  if (!Array.isArray(input[key])) return []
  return input[key]
}

function providerByID(input: unknown, key: "all" | "providers", id: string) {
  return providerList(input, key).find((provider) => isRecord(provider) && provider.id === id)
}

function hasNonZeroModelCost(input: unknown, key: "all" | "providers", id: string) {
  const provider = providerByID(input, key, id)
  if (!isRecord(provider) || !isRecord(provider.models)) return false
  return Object.values(provider.models).some((model) => {
    if (!isRecord(model) || !isRecord(model.cost) || !isRecord(model.cost.cache)) return false
    return [model.cost.input, model.cost.output, model.cost.cache.read, model.cost.cache.write].some(
      (cost) => typeof cost === "number" && cost > 0,
    )
  })
}

function hasProviderMutationMarker(input: unknown, key: "all" | "providers", id: string) {
  const provider = providerByID(input, key, id)
  if (!isRecord(provider)) return false
  if (provider.name === "mutated-provider") return true
  return isRecord(provider.options) && provider.options.mutatedByPlugin === true
}

function requestAuthorize(input: {
  providerID: string
  method: number
  headers: HeadersInit
  inputs?: Record<string, string>
}) {
  return Effect.gen(function* () {
    const response = yield* request(`/provider/${input.providerID}/oauth/authorize`, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify({ method: input.method, ...(input.inputs ? { inputs: input.inputs } : {}) }),
    })
    return {
      status: response.status,
      body: yield* response.text,
    }
  })
}

function requestCallback(input: { providerID: string; method: number; headers: HeadersInit; code?: string }) {
  return Effect.gen(function* () {
    const response = yield* request(`/provider/${input.providerID}/oauth/callback`, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify({ method: input.method, ...(input.code ? { code: input.code } : {}) }),
    })
    return {
      status: response.status,
      body: yield* response.text,
    }
  })
}

function writeProviderAuthPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-oauth-parity.ts"),
      [
        "export default {",
        '  id: "test.provider-oauth-parity",',
        "  server: async () => ({",
        "    auth: {",
        `      provider: "${providerID}",`,
        "      methods: [",
        '        { type: "api", label: "API key" },',
        "        {",
        '          type: "oauth",',
        '          label: "OAuth",',
        "          authorize: async () => ({",
        `            url: "${oauthURL}",`,
        '            method: "code",',
        `            instructions: "${oauthInstructions}",`,
        "            callback: async () => ({ type: 'success', key: 'token' }),",
        "          }),",
        "        },",
        "      ],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function writeProviderAuthValidationPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-oauth-validation.ts"),
      [
        "export default {",
        '  id: "test.provider-oauth-validation",',
        "  server: async () => ({",
        "    auth: {",
        '      provider: "test-oauth-validation",',
        "      methods: [",
        "        {",
        '          type: "oauth",',
        '          label: "OAuth",',
        "          prompts: [",
        "            {",
        '              type: "text",',
        '              key: "token",',
        '              message: "Token",',
        "              validate: (value) => value === 'ok' ? undefined : 'Token must be ok',",
        "            },",
        "          ],",
        "          authorize: async () => ({",
        `            url: "${oauthURL}",`,
        '            method: "code",',
        `            instructions: "${oauthInstructions}",`,
        "            callback: async () => ({ type: 'success', key: 'token' }),",
        "          }),",
        "        },",
        "      ],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function writeFunctionOptionsPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-function-options.ts"),
      [
        "export default {",
        '  id: "test.provider-function-options",',
        "  server: async () => ({",
        "    auth: {",
        '      provider: "google",',
        "      loader: async (_getAuth, provider) => {",
        "        for (const model of Object.values(provider.models ?? {})) {",
        "          model.cost = { input: 0, output: 0 }",
        "        }",
        "        return {",
        '        apiKey: "",',
        "        fetch: async (input, init) => fetch(input, init),",
        "        }",
        "      },",
        "      methods: [{ type: 'api', label: 'API key' }],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function writeProviderModelsMutationPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-models-mutation.ts"),
      [
        "export default {",
        '  id: "test.provider-models-mutation",',
        "  server: async () => ({",
        "    provider: {",
        '      id: "google",',
        "      models: async (provider) => {",
        "        const models = Object.fromEntries(",
        "          Object.entries(provider.models ?? {}).map(([id, model]) => [id, { ...model }]),",
        "        )",
        '        provider.name = "mutated-provider"',
        "        provider.options = { ...provider.options, mutatedByPlugin: true }",
        "        for (const model of Object.values(provider.models ?? {})) {",
        "          model.cost = { input: 0, output: 0 }",
        "        }",
        "        return models",
        "      },",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function setEnvScoped(key: string, value: string) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env[key]
      process.env[key] = value
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env[key]
        else process.env[key] = previous
      }),
  )
}

describe("provider HttpApi", () => {
  it.instance(
    "discovers models through the public API and returns actionable URL errors",
    () =>
      Effect.gen(function* () {
        const directory = (yield* TestInstance).directory
        const context = yield* Layer.build(NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }))
        const upstream = Context.get(context, HttpServer.HttpServer)
        const received: string[] = []
        yield* upstream.serve(
          Effect.gen(function* () {
            const req = yield* HttpServerRequest.HttpServerRequest
            received.push(req.url)
            expect(req.headers.authorization).toBe("Bearer catalog-test")
            return HttpServerResponse.jsonUnsafe({
              data: [{ id: "cc/test-model" }, { id: "coding-combo", name: "Coding" }],
            })
          }),
        )
        const baseURL = `${HttpServer.formatAddress(upstream.address)}/v1`
        const response = yield* request("/provider/discover", {
          method: "POST",
          headers: { "x-opencode-directory": directory, "content-type": "application/json" },
          body: JSON.stringify({ baseURL, apiKey: "catalog-test" }),
        })
        expect(response.status).toBe(200)
        const body = (yield* response.json) as {
          baseURL: string
          models: Array<{ id: string; name: string; limit: { context: number; output: number } }>
        }
        expect(body.baseURL).toBe(baseURL)
        expect(body.models.map((model) => [model.id, model.name])).toEqual([
          ["cc/test-model", "cc/test-model"],
          ["coding-combo", "Coding"],
        ])
        expect(body.models.every((model) => model.limit.context > 0 && model.limit.output > 0)).toBe(true)
        expect(received).toEqual(["/v1/models"])
        const invalid = yield* request("/provider/discover", {
          method: "POST",
          headers: { "x-opencode-directory": directory, "content-type": "application/json" },
          body: JSON.stringify({ baseURL: "file:///tmp/key", apiKey: "catalog-test" }),
        })
        expect(invalid.status).toBe(400)
        expect(yield* invalid.json).toEqual({
          message: "Use an HTTP or HTTPS API URL without credentials, query or fragment.",
        })
        expect(received).toEqual(["/v1/models"])
      }),
    projectOptions,
  )

  it.instance(
    "connects 9Router through the public API with positive model limits and the key outside config",
    () =>
      Effect.gen(function* () {
        const directory = (yield* TestInstance).directory
        const authFile = path.join(Global.Path.data, "auth.json")
        const configFiles = (names: string[]) => names.filter((name) => /\.jsonc?$/.test(name))
        // Connect writes the process-wide global config and credential files; restore them afterwards.
        yield* Effect.acquireRelease(
          Effect.promise(async () => {
            const names = configFiles(await fs.readdir(Global.Path.config).catch(() => []))
            return {
              config: await Promise.all(
                names.map(
                  async (name) => [name, await fs.readFile(path.join(Global.Path.config, name), "utf8")] as const,
                ),
              ),
              auth: await fs.readFile(authFile, "utf8").catch(() => undefined),
            }
          }),
          (saved) =>
            Effect.promise(async () => {
              const kept = new Map(saved.config)
              for (const name of configFiles(await fs.readdir(Global.Path.config).catch(() => []))) {
                if (!kept.has(name)) await fs.rm(path.join(Global.Path.config, name), { force: true })
              }
              for (const [name, text] of saved.config) await fs.writeFile(path.join(Global.Path.config, name), text)
              if (saved.auth === undefined) await fs.rm(authFile, { force: true })
              else await fs.writeFile(authFile, saved.auth)
            }),
        )
        const context = yield* Layer.build(NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }))
        const upstream = Context.get(context, HttpServer.HttpServer)
        yield* upstream.serve(
          Effect.succeed(
            HttpServerResponse.jsonUnsafe({
              data: [
                { id: "reported-combo", context_length: 200000, max_output_tokens: 16000 },
                { id: "mystery-combo" },
              ],
            }),
          ),
        )
        const baseURL = `${HttpServer.formatAddress(upstream.address)}/v1`
        const headers = { "x-opencode-directory": directory, "content-type": "application/json" }
        const response = yield* request("/provider/9router/connect", {
          method: "POST",
          headers,
          body: JSON.stringify({ baseURL, apiKey: "router-test-key" }),
        })
        expect(response.status).toBe(200)

        const providers = yield* request("/config/providers", { headers })
        expect(providers.status).toBe(200)
        const router = providerByID(yield* providers.json, "providers", "9router")
        const models = isRecord(router) ? router.models : undefined
        if (!isRecord(models)) throw new Error("9router provider was not loaded")
        const limit = (id: string) => {
          const model = models[id]
          return isRecord(model) && isRecord(model.limit) ? model.limit : undefined
        }
        expect(limit("reported-combo")).toMatchObject({ context: 200000, output: 16000 })
        expect(Number(limit("mystery-combo")?.context)).toBeGreaterThan(0)

        const savedConfig = (yield* Effect.promise(async () =>
          Promise.all(
            configFiles(await fs.readdir(Global.Path.config)).map((name) =>
              fs.readFile(path.join(Global.Path.config, name), "utf8"),
            ),
          ),
        )).join("\n")
        expect(savedConfig).toContain("mystery-combo")
        expect(savedConfig).not.toContain("router-test-key")
        expect(yield* Effect.promise(() => fs.readFile(authFile, "utf8"))).toContain("router-test-key")
      }),
    projectOptions,
  )

  it.instance(
    "connects an OpenAI-compatible endpoint with an environment reference and refuses built-in ids",
    () =>
      Effect.gen(function* () {
        const directory = (yield* TestInstance).directory
        const authFile = path.join(Global.Path.data, "auth.json")
        const configFiles = (names: string[]) => names.filter((name) => /\.jsonc?$/.test(name))
        yield* Effect.acquireRelease(
          Effect.promise(async () => {
            const names = configFiles(await fs.readdir(Global.Path.config).catch(() => []))
            return {
              config: await Promise.all(
                names.map(
                  async (name) => [name, await fs.readFile(path.join(Global.Path.config, name), "utf8")] as const,
                ),
              ),
              auth: await fs.readFile(authFile, "utf8").catch(() => undefined),
            }
          }),
          (saved) =>
            Effect.promise(async () => {
              const kept = new Map(saved.config)
              for (const name of configFiles(await fs.readdir(Global.Path.config).catch(() => []))) {
                if (!kept.has(name)) await fs.rm(path.join(Global.Path.config, name), { force: true })
              }
              for (const [name, text] of saved.config) await fs.writeFile(path.join(Global.Path.config, name), text)
              if (saved.auth === undefined) await fs.rm(authFile, { force: true })
              else await fs.writeFile(authFile, saved.auth)
            }),
        )
        yield* setEnvScoped("HTTPAPI_COMPATIBLE_KEY", "compatible-env-secret")
        const context = yield* Layer.build(NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }))
        const upstream = Context.get(context, HttpServer.HttpServer)
        const received: Array<string | undefined> = []
        yield* upstream.serve(
          Effect.gen(function* () {
            const req = yield* HttpServerRequest.HttpServerRequest
            received.push(req.headers.authorization)
            return HttpServerResponse.jsonUnsafe({ data: [{ id: "compatible-model", context_length: 64000 }] })
          }),
        )
        const baseURL = `${HttpServer.formatAddress(upstream.address)}/v1`
        const headers = { "x-opencode-directory": directory, "content-type": "application/json" }

        const refused = yield* request("/provider/openai-compatible/connect", {
          method: "POST",
          headers,
          body: JSON.stringify({ providerID: "anthropic", baseURL }),
        })
        expect(refused.status).toBe(400)
        expect(yield* refused.json).toMatchObject({ reason: "builtin_provider" })
        expect(received).toEqual([])

        const response = yield* request("/provider/openai-compatible/connect", {
          method: "POST",
          headers,
          body: JSON.stringify({
            providerID: "compatible-test",
            name: "Compatible Test",
            baseURL,
            apiKey: "{env:HTTPAPI_COMPATIBLE_KEY}",
          }),
        })
        expect(response.status).toBe(200)
        const body = yield* response.json
        expect(body).toMatchObject({ providerID: "compatible-test", credential: "reference", discovered: true })
        expect(JSON.stringify(body)).not.toContain("compatible-env-secret")
        expect(received).toEqual(["Bearer compatible-env-secret"])

        const providers = yield* request("/config/providers", { headers })
        const connected = providerByID(yield* providers.json, "providers", "compatible-test")
        const models = isRecord(connected) ? connected.models : undefined
        if (!isRecord(models)) throw new Error("compatible-test provider was not loaded")
        expect(Object.keys(models)).toEqual(["compatible-model"])

        const savedConfig = (yield* Effect.promise(async () =>
          Promise.all(
            configFiles(await fs.readdir(Global.Path.config)).map((name) =>
              fs.readFile(path.join(Global.Path.config, name), "utf8"),
            ),
          ),
        )).join("\n")
        expect(savedConfig).toContain("{env:HTTPAPI_COMPATIBLE_KEY}")
        expect(savedConfig).not.toContain("compatible-env-secret")
        expect(
          (yield* Effect.promise(() => fs.readFile(authFile, "utf8").catch(() => ""))).includes(
            "compatible-env-secret",
          ),
        ).toBe(false)
      }),
    projectOptions,
  )

  it.instance(
    "removes a provider with every setting that names it, previews it first, and reconnecting unhides it",
    () =>
      Effect.gen(function* () {
        const directory = (yield* TestInstance).directory
        const authFile = path.join(Global.Path.data, "auth.json")
        const configFile = path.join(Global.Path.config, "config.jsonc")
        const configFiles = (names: string[]) => names.filter((name) => /\.jsonc?$/.test(name))
        const headers = { "x-opencode-directory": directory, "content-type": "application/json" }
        yield* Effect.acquireRelease(
          Effect.promise(async () => {
            const names = configFiles(await fs.readdir(Global.Path.config).catch(() => []))
            return {
              config: await Promise.all(
                names.map(
                  async (name) => [name, await fs.readFile(path.join(Global.Path.config, name), "utf8")] as const,
                ),
              ),
              auth: await fs.readFile(authFile, "utf8").catch(() => undefined),
            }
          }),
          (saved) =>
            Effect.promise(async () => {
              const kept = new Map(saved.config)
              for (const name of configFiles(await fs.readdir(Global.Path.config).catch(() => []))) {
                if (!kept.has(name)) await fs.rm(path.join(Global.Path.config, name), { force: true })
              }
              for (const [name, text] of saved.config) await fs.writeFile(path.join(Global.Path.config, name), text)
              if (saved.auth === undefined) await fs.rm(authFile, { force: true })
              else await fs.writeFile(authFile, saved.auth)
            }),
        )
        const intelligence = yield* request("/api/intelligence", { headers })
        const previous = ((yield* intelligence.json) as { settings: unknown }).settings
        yield* Effect.addFinalizer(() =>
          request("/api/intelligence", {
            method: "PUT",
            headers,
            body: JSON.stringify({ settings: previous }),
          }).pipe(Effect.ignore),
        )

        const stored = yield* request("/auth/removal-test", {
          method: "PUT",
          headers,
          body: JSON.stringify({ type: "api", key: "removal-test-key" }),
        })
        expect(stored.status).toBe(200)
        const fixture = {
          provider: {
            "removal-test": {
              npm: "@ai-sdk/openai-compatible",
              name: "Removal Test",
              options: { baseURL: "http://127.0.0.1:1/v1" },
              models: { m: { name: "m" } },
            },
          },
          model: "removal-test/m",
          small_model: "removal-test/m",
          agent: { build: { model: "removal-test/m" } },
          command: { review: { model: "removal-test/m", template: "review" } },
          disabled_providers: ["removal-test"],
        }
        yield* Effect.promise(() => fs.writeFile(configFile, JSON.stringify(fixture, null, 2)))
        const configured = yield* request("/api/intelligence", {
          method: "PUT",
          headers,
          body: JSON.stringify({
            settings: {
              enabled: false,
              reasoning: "single",
              onboarding: "completed",
              principal: { providerID: "removal-test", id: "m" },
            },
          }),
        })
        expect(configured.status).toBe(200)

        const preview = yield* request("/provider/removal-test?dryRun=true", { method: "DELETE", headers })
        expect(preview.status).toBe(200)
        expect(yield* preview.json).toMatchObject({
          providerID: "removal-test",
          dryRun: true,
          removed: {
            credential: true,
            config: true,
            references: [
              "default model",
              "small model",
              "agent build",
              "command review",
              "disabled providers",
              "S2 principal",
            ],
          },
          configPath: configFile,
        })
        expect(yield* Effect.promise(() => fs.readFile(configFile, "utf8"))).toContain("removal-test")
        expect(yield* Effect.promise(() => fs.readFile(authFile, "utf8"))).toContain("removal-test-key")

        const removed = yield* request("/provider/removal-test", { method: "DELETE", headers })
        expect(removed.status).toBe(200)
        expect(yield* removed.json).toMatchObject({ dryRun: false, removed: { credential: true, config: true } })
        expect(yield* Effect.promise(() => fs.readFile(configFile, "utf8"))).not.toContain("removal-test")
        expect(yield* Effect.promise(() => fs.readFile(authFile, "utf8"))).not.toContain("removal-test-key")
        const after = yield* request("/api/intelligence", { headers })
        expect(((yield* after.json) as { settings: { principal?: unknown } }).settings.principal).toBeUndefined()

        // A provider hidden with disabled_providers is shown again once it is connected again.
        yield* Effect.promise(() =>
          fs.writeFile(configFile, JSON.stringify({ disabled_providers: ["removal-test", "other-hidden"] }, null, 2)),
        )
        const reconnected = yield* request("/auth/removal-test", {
          method: "PUT",
          headers,
          body: JSON.stringify({ type: "api", key: "removal-test-key" }),
        })
        expect(reconnected.status).toBe(200)
        expect(JSON.parse(yield* Effect.promise(() => fs.readFile(configFile, "utf8")))).toEqual({
          disabled_providers: ["other-hidden"],
        })
        yield* request("/provider/removal-test", { method: "DELETE", headers })
      }),
    projectOptions,
    30000,
  )

  it.instance(
    "removing a provider the environment loads hides it until it is connected again",
    () =>
      Effect.gen(function* () {
        const directory = (yield* TestInstance).directory
        const authFile = path.join(Global.Path.data, "auth.json")
        const configFile = path.join(Global.Path.config, "config.jsonc")
        const headers = { "x-opencode-directory": directory, "content-type": "application/json" }
        yield* Effect.acquireRelease(
          Effect.promise(async () => ({
            config: await fs.readFile(configFile, "utf8").catch(() => undefined),
            auth: await fs.readFile(authFile, "utf8").catch(() => undefined),
            env: process.env.ANTHROPIC_API_KEY,
          })),
          (saved) =>
            Effect.promise(async () => {
              if (saved.config === undefined) await fs.rm(configFile, { force: true })
              else await fs.writeFile(configFile, saved.config)
              if (saved.auth === undefined) await fs.rm(authFile, { force: true })
              else await fs.writeFile(authFile, saved.auth)
              if (saved.env === undefined) delete process.env.ANTHROPIC_API_KEY
              else process.env.ANTHROPIC_API_KEY = saved.env
            }),
        )
        yield* Effect.promise(() =>
          fs.writeFile(configFile, JSON.stringify({ disabled_providers: ["other"] }, null, 2)),
        )
        process.env.ANTHROPIC_API_KEY = "env-anthropic-key"

        const removed = yield* request("/provider/anthropic", { method: "DELETE", headers })
        expect(removed.status).toBe(200)
        expect(yield* removed.json).toMatchObject({
          dryRun: false,
          removed: { hidden: true },
          envVariables: ["ANTHROPIC_API_KEY"],
        })
        expect(JSON.parse(yield* Effect.promise(() => fs.readFile(configFile, "utf8"))).disabled_providers).toEqual([
          "other",
          "anthropic",
        ])
        // Reloaded after the removal, the environment variable no longer brings it back.
        const listed = yield* request("/provider", { headers })
        expect(((yield* listed.json) as { connected: string[] }).connected).not.toContain("anthropic")

        const reconnected = yield* request("/auth/anthropic", {
          method: "PUT",
          headers,
          body: JSON.stringify({ type: "api", key: "saved-anthropic-key" }),
        })
        expect(reconnected.status).toBe(200)
        // The reload may add a $schema key; only the disabled list matters here.
        expect(JSON.parse(yield* Effect.promise(() => fs.readFile(configFile, "utf8"))).disabled_providers).toEqual([
          "other",
        ])
      }),
    projectOptions,
    30000,
  )

  it.instance.skip(
    "returns public v2 provider not found errors",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* request("/api/provider/missing", {
        headers: { "x-opencode-directory": directory },
      })

      expect(response.status).toBe(404)
      expect(yield* response.json).toEqual({
        _tag: "ProviderNotFoundError",
        providerID: "missing",
        message: "Provider not found: missing",
      })
    }),
    projectOptions,
  )

  it.instance(
    "serves OAuth authorize response shapes",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const headers = { "x-opencode-directory": directory, "content-type": "application/json" }
      const api = yield* requestAuthorize({
        providerID,
        method: 0,
        headers,
      })
      // method 0 (api-key style) — authorize() resolves with no further
      // redirect; #26474 changed the wire format to JSON `null` so clients
      // can `.json()` parse uniformly instead of getting an empty body
      // that throws.
      expect(api).toEqual({ status: 200, body: "null" })

      const oauth = yield* requestAuthorize({
        providerID,
        method: 1,
        headers,
      })
      expect(JSON.parse(oauth.body)).toEqual({
        url: oauthURL,
        method: "code",
        instructions: oauthInstructions,
      })
    }),
    { ...projectOptions, init: writeProviderAuthPlugin },
    30000,
  )

  it.instance(
    "returns declared provider auth validation errors",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* requestAuthorize({
        providerID: "test-oauth-validation",
        method: 0,
        inputs: { token: "nope" },
        headers: { "x-opencode-directory": directory, "content-type": "application/json" },
      })

      expect(response.status).toBe(400)
      expect(JSON.parse(response.body)).toEqual({
        name: "ProviderAuthValidationFailed",
        data: { field: "token", message: "Token must be ok" },
      })
    }),
    { ...projectOptions, init: writeProviderAuthValidationPlugin },
    30000,
  )

  it.instance(
    "returns declared provider auth callback errors",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* requestCallback({
        providerID,
        method: 0,
        headers: { "x-opencode-directory": directory, "content-type": "application/json" },
      })

      expect(response.status).toBe(400)
      expect(JSON.parse(response.body)).toEqual({
        name: "ProviderAuthOauthMissing",
        data: { providerID },
      })
    }),
    projectOptions,
    30000,
  )

  it.instance(
    "serves provider lists when auth loaders add runtime fetch options",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      yield* setEnvScoped(
        "REDCODE_AUTH_CONTENT",
        JSON.stringify({
          google: { type: "oauth", refresh: "dummy", access: "dummy", expires: 9999999999999 },
        }),
      )
      const headers = { "x-opencode-directory": directory }
      const providerResponse = yield* request("/provider", { headers })
      const configResponse = yield* request("/config/providers", { headers })

      expect(providerResponse.status).toBe(200)
      expect(configResponse.status).toBe(200)

      const providerBody = yield* providerResponse.json
      const configBody = yield* configResponse.json
      expect(hasProviderWithFetch(providerBody, "all")).toBe(false)
      expect(hasProviderWithFetch(configBody, "providers")).toBe(false)
      expect(hasNonZeroModelCost(providerBody, "all", "google")).toBe(true)
      expect(hasNonZeroModelCost(configBody, "providers", "google")).toBe(true)
    }),
    { ...projectOptions, init: writeFunctionOptionsPlugin },
  )

  it.instance(
    "keeps provider.models hook input mutations out of provider state",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory

      const headers = { "x-opencode-directory": directory }
      const providerResponse = yield* request("/provider", { headers })
      const configResponse = yield* request("/config/providers", { headers })

      expect(providerResponse.status).toBe(200)
      expect(configResponse.status).toBe(200)

      const providerBody = yield* providerResponse.json
      const configBody = yield* configResponse.json
      expect(hasProviderMutationMarker(providerBody, "all", "google")).toBe(false)
      expect(hasProviderMutationMarker(configBody, "providers", "google")).toBe(false)
      expect(hasNonZeroModelCost(providerBody, "all", "google")).toBe(true)
    }),
    { ...projectOptions, init: writeProviderModelsMutationPlugin },
  )
})
