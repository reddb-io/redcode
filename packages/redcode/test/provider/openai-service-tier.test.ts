import { expect, test } from "bun:test"
import { createOpenAI } from "@ai-sdk/openai"

for (const endpoint of ["responses", "chat"] as const) {
  for (const tier of ["priority", "flex"] as const) {
    test(`${endpoint} preserves explicit ${tier} for a model unknown to SDK capability heuristics`, async () => {
      let sent: unknown
      await using server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          sent = await request.json()
          return Response.json(
            endpoint === "responses"
              ? {
                  id: "resp_fixture",
                  created_at: 0,
                  model: "gateway-model",
                  output: [],
                  usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
                }
              : {
                  id: "chatcmpl_fixture",
                  created: 0,
                  model: "gateway-model",
                  choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
                  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                },
          )
        },
      })
      const provider = createOpenAI({
        apiKey: "fixture",
        baseURL: server.url.href,
      })
      const model = endpoint === "responses" ? provider.responses("gateway-model") : provider.chat("gateway-model")
      await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        providerOptions: { openai: { serviceTier: tier } },
      })
      expect(sent).toMatchObject({ service_tier: tier })
    })
  }
}
