import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { Database } from "@reddb-io/redcode-core/database/database"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ConfigProviderV1 } from "@reddb-io/redcode-core/v1/config/provider"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageID } from "@/session/schema"
import { ModelsTool } from "@/tool/models"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([Provider.node, Session.node, ToolOutputBridge.node, Database.node])),
)

const model = (name: string, release_date: string, extra: Partial<typeof ConfigProviderV1.Model.Type> = {}) => ({
  name,
  release_date,
  tool_call: true,
  limit: { context: 100_000, output: 10_000 },
  ...extra,
})

const provider = (name: string, models: Record<string, ReturnType<typeof model>>, whitelist?: string[]) => ({
  name,
  env: [],
  npm: "@ai-sdk/openai-compatible",
  options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
  models,
  ...(whitelist ? { whitelist } : {}),
})

/**
 * Zeta is the session's own provider. `jev` is what vivgrid serves as a System One evaluator, so no
 * subagent may run on it; zeta-old is deprecated.
 */
const config = {
  enabled_providers: ["alpha", "vivgrid", "zeta"],
  provider: {
    zeta: provider("Zeta", {
      "zeta-2": model("Zeta 2", "2025-06-01", { family: "zeta", reasoning: true }),
      "zeta-1": model("Zeta 1", "2025-01-01", { family: "zeta" }),
      "zeta-old": model("Zeta Old", "2024-01-01", { status: "deprecated" }),
      "zeta-vision": model("Zeta Vision", "2025-03-01", {
        family: "zeta-vision",
        attachment: true,
        cost: { input: 1, output: 4 },
      }),
    }),
    alpha: provider("Alpha", { "alpha-large": model("Alpha Large", "2025-05-01", { family: "alpha" }) }),
    vivgrid: provider(
      "Vivgrid",
      { jev: model("Jev", "2025-07-01"), "vivgrid-chat": model("Vivgrid Chat", "2025-02-01") },
      ["jev", "vivgrid-chat"],
    ),
  },
}

const search = Effect.fn("ModelsToolTest.search")(function* (params: {
  query?: string
  provider?: string
  capabilities?: ("reasoning" | "tool_call" | "attachments")[]
  all?: boolean
  limit?: number
  cursor?: string
}) {
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({
    title: "models",
    model: { id: ModelV2.ID.make("zeta-2"), providerID: ProviderV2.ID.make("zeta") },
  })
  const def = yield* (yield* ModelsTool).init()
  return yield* def
    .execute(params, {
      sessionID: chat.id,
      messageID: MessageID.ascending(),
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => Effect.void,
      ask: () => Effect.void,
    })
    .pipe(Effect.exit)
})

const output = (exit: Exit.Exit<{ output: string }, unknown>) => (Exit.isSuccess(exit) ? exit.value.output : "")

describe("tool.models", () => {
  it.instance(
    "lists your provider first, then the others, newest first and one per family",
    () =>
      Effect.gen(function* () {
        const exit = yield* search({})
        const text = output(exit)
        const order = ["zeta/zeta-2", "zeta/zeta-vision", "alpha/alpha-large", "vivgrid/vivgrid-chat"].map((id) =>
          text.indexOf(id),
        )

        expect(order.every((index) => index >= 0)).toBe(true)
        expect(order).toEqual(order.toSorted((a, b) => a - b))
        expect(text).not.toContain("zeta/zeta-1 ")
        expect(Exit.isSuccess(exit) ? exit.value.metadata.total : 0).toBe(4)

        const all = output(yield* search({ all: true }))
        expect(all.indexOf("zeta/zeta-1 ")).toBeGreaterThan(all.indexOf("zeta/zeta-2"))
      }),
    { config },
  )

  it.instance(
    "never lists a System One evaluator or a deprecated model",
    () =>
      Effect.gen(function* () {
        const text = output(yield* search({ all: true }))
        expect(text).not.toContain("vivgrid/jev")
        expect(text).not.toContain("zeta/zeta-old")
        expect(output(yield* search({ query: "jev" }))).toContain("No model matches")
      }),
    { config },
  )

  it.instance(
    "filters by words, provider id or name, and capabilities, and shows limits and known cost",
    () =>
      Effect.gen(function* () {
        const vision = output(yield* search({ query: "zeta VISION" }))
        expect(vision).toContain("zeta/zeta-vision · Zeta Vision · provider Zeta")
        expect(vision).toContain("context 100000 tokens, output 10000")
        expect(vision).toContain("$1 input, $4 output per 1M tokens")
        expect(vision).not.toContain("zeta/zeta-2")

        const named = output(yield* search({ provider: "Alpha" }))
        expect(named).toContain("alpha/alpha-large")
        expect(named).not.toContain("zeta/")
        // No price was given, so none is shown rather than a free one.
        expect(named).not.toContain("per 1M tokens")

        const reasoning = output(yield* search({ capabilities: ["reasoning"] }))
        expect(reasoning).toContain("zeta/zeta-2")
        expect(reasoning).toContain("variants:")
        expect(reasoning).not.toContain("alpha/alpha-large")

        const attachments = output(yield* search({ capabilities: ["attachments"], provider: "zeta" }))
        expect(attachments).toContain("zeta/zeta-vision")
        expect(attachments).not.toContain("zeta/zeta-2")
      }),
    { config },
  )

  it.instance(
    "pages through the matches with a cursor",
    () =>
      Effect.gen(function* () {
        const first = yield* search({ limit: 2 })
        expect(Exit.isSuccess(first) ? first.value.metadata : {}).toMatchObject({ total: 4, count: 2, next: "2" })
        expect(output(first)).toContain(`cursor "2"`)
        expect(output(first)).toContain("zeta/zeta-2")
        expect(output(first)).not.toContain("alpha/alpha-large")

        const second = yield* search({ limit: 2, cursor: "2" })
        const last = Exit.isSuccess(second) ? second.value.metadata : {}
        expect(last).toMatchObject({ total: 4, count: 2 })
        expect(last).not.toHaveProperty("next")
        expect(output(second)).toContain("alpha/alpha-large")
        expect(output(second)).toContain("vivgrid/vivgrid-chat")
        expect(output(second)).not.toContain("cursor")

        const bad = yield* search({ cursor: "next" })
        expect(Exit.isFailure(bad) ? String(Cause.squash(bad.cause)) : "").toContain(`Invalid cursor "next"`)
      }),
    { config },
  )
})
