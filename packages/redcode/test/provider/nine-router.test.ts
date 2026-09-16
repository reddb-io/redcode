import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import type { Auth } from "../../src/auth"
import { ProviderDiscovery } from "../../src/provider/discovery"
import { NineRouter } from "../../src/provider/nine-router"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const it = testEffect(FetchHttpClient.layer)

const discovered = {
  baseURL: "http://127.0.0.1:20128/v1",
  models: [
    { id: "cc/new", name: "New", limit: { context: 200000, output: 64000 }, estimated: false },
    { id: "kept", name: "Kept", limit: ProviderDiscovery.GUESSED_LIMIT, estimated: true },
  ],
}

describe("NineRouter.plan", () => {
  test("adds new models with limits, keeps user settings and prunes only stale discovered models", () => {
    const result = NineRouter.plan(
      {
        kept: { name: "My name", limit: { context: 1000, output: 100 } },
        "stale-discovered": { name: "Old" },
        "stale-with-limit": { name: "Old", limit: { context: 128000, output: 8192 } },
        "stale-customized": { name: "Tuned", options: { reasoningEffort: "high" } },
      },
      discovered,
    )
    expect(result.provider).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "9Router",
      options: { baseURL: "http://127.0.0.1:20128/v1" },
      models: { "cc/new": { name: "New", limit: { context: 200000, output: 64000 } }, kept: {} },
    })
    expect(result.remove.toSorted()).toEqual(["stale-discovered", "stale-with-limit"])
  })

  test("adds limits to a previously discovered model that has none", () => {
    expect(NineRouter.plan({ kept: { name: "Kept" } }, discovered).provider.models.kept).toEqual({
      limit: ProviderDiscovery.GUESSED_LIMIT,
    })
  })
})

function router(body: unknown, status = 200) {
  return Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(body, { status }) })),
    (server) => Effect.promise(() => server.stop(true)),
  )
}

function fakes(existing: Record<string, object>) {
  const calls: string[] = []
  const writes: Array<{ config: unknown; remove: unknown }> = []
  const stored: Array<{ key: string; info: unknown }> = []
  const config = TestConfig.make({
    readGlobalFile: () =>
      Effect.succeed({ path: "/global/config.jsonc", data: { provider: { "9router": { models: existing } } } }),
    updateGlobal: (next, options) =>
      Effect.sync(() => {
        calls.push("config")
        writes.push({ config: next, remove: options?.remove })
        return { info: next, changed: true }
      }),
  })
  const auth = {
    get: () => Effect.succeed(undefined),
    remove: (key: string) =>
      Effect.sync(() => {
        calls.push(`auth.remove:${key}`)
      }),
    set: (key: string, info: unknown) =>
      Effect.sync(() => {
        calls.push("auth")
        stored.push({ key, info })
      }),
  } as unknown as Auth.Interface
  return { calls, writes, stored, config, auth }
}

it.effect("connect saves models with a positive context before the key and prunes stale discovered models", () =>
  Effect.gen(function* () {
    const server = yield* router({ data: [{ id: "cc/claude-test" }, { id: "mystery-combo" }] })
    const fake = fakes({ gone: { name: "Gone" }, custom: { name: "Custom", options: { tuned: true } } })
    const http = yield* HttpClient.HttpClient
    const catalog = ProviderDiscovery.catalogLimits({
      anthropic: { models: { "claude-test": { limit: { context: 200000, output: 64000 } } } },
    })
    yield* NineRouter.connect(
      { http, config: fake.config, auth: fake.auth, catalog },
      { baseURL: `${server.url}v1`, apiKey: " secret-router-key " },
    )
    expect(fake.calls).toEqual(["config", "auth"])
    expect(fake.writes).toHaveLength(1)
    expect(fake.writes[0].remove).toEqual([["provider", "9router", "models", "gone"]])
    const models = (fake.writes[0].config as { provider: Record<string, { models: Record<string, ModelWrite> }> })
      .provider["9router"].models
    expect(models["cc/claude-test"]).toEqual({ name: "cc/claude-test", limit: { context: 200000, output: 64000 } })
    expect(models["mystery-combo"].limit?.context).toBeGreaterThan(0)
    expect(JSON.stringify(fake.writes[0].config)).not.toContain("secret-router-key")
    expect(fake.stored).toEqual([
      { key: "9router", info: expect.objectContaining({ type: "api", key: "secret-router-key" }) },
    ])
  }),
)

type ModelWrite = { name?: string; limit?: { context: number; output: number } }

it.effect("connect saves nothing when discovery fails", () =>
  Effect.gen(function* () {
    const server = yield* router({ error: "unauthorized" }, 401)
    const fake = fakes({})
    const http = yield* HttpClient.HttpClient
    const error = yield* NineRouter.connect(
      { http, config: fake.config, auth: fake.auth },
      { baseURL: `${server.url}v1`, apiKey: "bad" },
    ).pipe(Effect.flip)
    expect(error.message).toContain("refused this API key")
    expect(fake.calls).toEqual([])
  }),
)
