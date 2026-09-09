import { expect, test } from "bun:test"
import { getModelMapping, isResponsesApiModel } from "gitlab-ai-provider"

test("GitLab Duo routes GPT-6 Astra through the Responses API", () => {
  expect(getModelMapping("duo-chat-gpt-6-astra")).toEqual({
    provider: "openai",
    model: "gpt-6-astra",
    openaiApiType: "responses",
  })
  expect(isResponsesApiModel("duo-chat-gpt-6-astra")).toBe(true)
})
