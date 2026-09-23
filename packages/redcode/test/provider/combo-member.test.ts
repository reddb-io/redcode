import { afterEach, describe, expect, test } from "bun:test"
import { ProviderRouter } from "@reddb-io/redcode-core/provider/router"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ComboMember } from "../../src/provider/combo-member"
import { ProviderTransform } from "../../src/provider/transform"
import type { Provider } from "../../src/provider/provider"
import type { ConfigProviderV1 } from "@reddb-io/redcode-core/v1/config/provider"

const LEAD = { context_length: 1_000_000, max_completion_tokens: 64_000, thinking_levels: ["none", "low", "high"] }
const MEMBER = {
  context_length: 200_000,
  max_completion_tokens: 16_000,
  thinking_levels: ["none", "low", "medium"],
  thinking_can_disable: false,
  forced_tool_choice: false,
}

const media = { text: true, audio: false, image: false, video: false, pdf: false }

function combo(limit = { context: LEAD.context_length, output: LEAD.max_completion_tokens }): Provider.Model {
  const model: Provider.Model = {
    id: ModelV2.ID.make("fast"),
    providerID: ProviderV2.ID.make("red-router"),
    api: { id: "fast", npm: "@ai-sdk/openai-compatible", url: "" },
    name: "Fast",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: media,
      output: media,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit,
    status: "active",
    options: {},
    headers: {},
    release_date: "",
    variants: {},
  }
  return { ...model, variants: ProviderTransform.effortVariants(model, LEAD.thinking_levels) }
}

function declared(
  router: { strategy?: string; parameters?: ConfigProviderV1.RouterParameters; parameters_basis?: string } = {},
) {
  return {
    router: {
      owned_by: "combo",
      strategy: "fallback",
      parameters: LEAD,
      parameters_basis: "lead",
      members: ["cc/lead", "cc/other", "cc/third"],
      member_parameters: [
        { id: "cc/lead", parameters: LEAD },
        { id: "cc/other", parameters: MEMBER },
      ],
      ...router,
    },
  }
}

const observe = (servedModel: string | undefined, router: ComboMember.ObserveInput["declared"] = declared()) =>
  ComboMember.observe({ sessionID: "ses_a", providerID: "red-router", modelID: "fast", servedModel, declared: router })

afterEach(() => {
  ComboMember.reset()
  ProviderRouter.forgetCatalogs()
})

describe("ComboMember", () => {
  test("keeps the lead's parameters while the lead serves", async () => {
    await observe("cc/lead")
    const model = combo()
    expect(ComboMember.model("ses_a", model)).toBe(model)
    expect(ComboMember.effectiveRouterParameters("ses_a", "red-router", "fast", declared())).toEqual(LEAD)
  })

  test("switches to a fallback member's parameters while it serves", async () => {
    await observe("cc/other")
    const model = ComboMember.model("ses_a", combo())
    expect(model.limit).toEqual({ context: 200_000, output: 16_000 })
    expect(ProviderTransform.maxOutputTokens(combo())).toBe(ProviderTransform.OUTPUT_TOKEN_MAX)
    expect(ProviderTransform.maxOutputTokens(model)).toBe(16_000)
    // The member cannot stop thinking, so `none` is gone; `medium` is the member's own level.
    expect(Object.keys(model.variants ?? {})).toEqual(["low", "medium"])
    const parameters = ComboMember.effectiveRouterParameters("ses_a", "red-router", "fast", declared())
    expect(parameters?.thinking_can_disable).toBe(false)
    expect(ProviderTransform.supportsForcedToolChoice(model, parameters)).toBe(false)
    expect(ProviderTransform.supportsForcedToolChoice(combo(), declared().router.parameters)).toBe(true)
    // Other sessions on the same combo still plan for the lead.
    expect(ComboMember.model("ses_b", combo()).limit.context).toBe(LEAD.context_length)
  })

  test("keeps the member's parameters while it keeps serving and returns to the lead's", async () => {
    await observe("cc/other")
    await observe(undefined)
    expect(ComboMember.model("ses_a", combo()).limit.context).toBe(200_000)
    await observe("cc/other")
    expect(ComboMember.model("ses_a", combo()).limit.context).toBe(200_000)
    await observe("cc/lead")
    const model = combo()
    expect(ComboMember.model("ses_a", model)).toBe(model)
    expect(ComboMember.effectiveRouterParameters("ses_a", "red-router", "fast", declared())).toEqual(LEAD)
  })

  test("matches a served model reported without its provider prefix", async () => {
    await observe("other")
    expect(ComboMember.model("ses_a", combo()).limit.context).toBe(200_000)
    await observe("lead")
    expect(ComboMember.model("ses_a", combo()).limit.context).toBe(LEAD.context_length)
  })

  test("reads a member missing from the saved parameters once, then reuses it", async () => {
    const requests: Array<{ path: string; authorization: string | null }> = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") })
        return Response.json({
          id: "cc/third",
          object: "model",
          parameters: { context_length: 64_000, max_completion_tokens: 8_000 },
        })
      },
    })
    const read = (sessionID: string) =>
      ComboMember.observe({
        sessionID,
        providerID: "red-router",
        modelID: "fast",
        servedModel: "cc/third",
        declared: declared(),
        baseURL: `${server.url}v1`,
        apiKey: "sk-test",
      })
    try {
      await read("ses_a")
      expect(ComboMember.model("ses_a", combo()).limit).toEqual({ context: 64_000, output: 8_000 })
      await read("ses_a")
      await read("ses_b")
      expect(ComboMember.model("ses_b", combo()).limit).toEqual({ context: 64_000, output: 8_000 })
      expect(requests).toEqual([{ path: "/v1/models/cc/third", authorization: "Bearer sk-test" }])
    } finally {
      await server.stop(true)
    }
  })

  test("keeps the lead's parameters for a member the router cannot describe", async () => {
    let calls = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        calls++
        return new Response("not found", { status: 404 })
      },
    })
    const read = () =>
      ComboMember.observe({
        sessionID: "ses_a",
        providerID: "red-router",
        modelID: "fast",
        servedModel: "cc/third",
        declared: declared(),
        baseURL: `${server.url}v1`,
      })
    try {
      await read()
      await read()
      const model = combo()
      expect(ComboMember.model("ses_a", model)).toBe(model)
      expect(calls).toBe(1)
    } finally {
      await server.stop(true)
    }
  })

  test("never switches a combo whose parameters are the strictest member's", async () => {
    await observe("cc/other", declared({ strategy: "round-robin", parameters: MEMBER, parameters_basis: "strictest" }))
    const model = combo()
    expect(ComboMember.model("ses_a", model)).toBe(model)
    expect(
      ComboMember.effectiveRouterParameters("ses_a", "red-router", "fast", declared({ parameters: MEMBER })),
    ).toEqual(MEMBER)
  })

  test("behaves as before for a router that reports no basis or member parameters", async () => {
    const older = {
      router: { owned_by: "combo", strategy: "fallback", parameters: MEMBER, members: ["cc/lead", "cc/other"] },
    }
    await observe("cc/other", older)
    const model = combo()
    expect(ComboMember.model("ses_a", model)).toBe(model)
    expect(ComboMember.effectiveRouterParameters("ses_a", "red-router", "fast", older)).toEqual(MEMBER)
    expect(ComboMember.memberVariants(model, older)).toBeUndefined()
  })

  test("switching members leaves the recorded catalog version alone", async () => {
    ProviderRouter.recordCatalog("red-router", "http://127.0.0.1:20128/v1", "v1")
    await observe("cc/other")
    await observe("cc/lead")
    expect(ProviderRouter.catalogChanged("red-router", "http://127.0.0.1:20128/v1", "v1")).toBe(false)
  })

  test("keeps a limit set by hand", async () => {
    await observe("cc/other")
    expect(ComboMember.model("ses_a", combo({ context: 150_000, output: 64_000 })).limit).toEqual({
      context: 150_000,
      output: 16_000,
    })
  })

  test("tells clients each member's variants, the lead first", () => {
    expect(ComboMember.memberVariants(combo(), declared())).toEqual([
      { id: "cc/lead", variants: ["none", "low", "high"] },
      { id: "cc/other", variants: ["low", "medium"] },
    ])
  })
})
