export * as ConfigModelReasoningV1 from "./model-reasoning.js"

import { Provider } from "../../provider.js"

/** V1 request defaults gated by a configured model's reasoning capability. */
export function defaults(input: {
  providerID: string
  modelID: string
  packageName?: string
  baseURL?: unknown
  useCompletionUrls?: unknown
}) {
  const name = Provider.packageName(input.packageName)
  const id = input.modelID.toLowerCase()
  const version = /(?:^|\/)gpt-(\d+)(?:\.(\d+))?/.exec(id)
  const major = Number(version?.[1])
  const minor = Number(version?.[2] ?? 0)
  if (major >= 5 && !/-chat(?:-|$)|-pro(?:-|$)/.test(id)) {
    const openai = name === "@ai-sdk/openai"
    const azure = name === "@ai-sdk/azure"
    const copilot = name === "@ai-sdk/github-copilot"
    const mantle = name === "@ai-sdk/amazon-bedrock/mantle"
    if (
      (openai || azure || copilot || mantle) &&
      !(azure && input.useCompletionUrls === true && (major > 5 || (major === 5 && minor >= 5)))
    )
      return {
        settings: {
          reasoningEffort: "medium",
          reasoningSummary: "auto",
          ...(openai || mantle ? { include: ["reasoning.encrypted_content"] } : {}),
        },
      }
  }
  if (
    name === "@ai-sdk/google" ||
    name === "@ai-sdk/google-vertex" ||
    name === "@opencode/ai/providers/google" ||
    name === "@opencode/ai/providers/google-vertex" ||
    name === "@opencode/ai/providers/google-vertex/gemini"
  )
    return {
      settings: {
        thinkingConfig: { includeThoughts: true, ...(id.includes("gemini-3") ? { thinkingLevel: "high" } : {}) },
      },
    }

  if (
    id.includes("gemini-3") &&
    (name === "@openrouter/ai-sdk-provider" ||
      name === "@llmgateway/ai-sdk-provider" ||
      name === "@opencode/ai/providers/openrouter")
  )
    return { settings: { reasoning: { effort: "high" } } }

  if (
    id.includes("minimax-m3") &&
    (name === "@ai-sdk/anthropic" || name === "@opencode/ai/providers/minimax/messages")
  )
    return { settings: { thinking: { type: "adaptive" } } }

  if (
    /zai|zhipuai/iu.test(input.providerID) &&
    (name === "@ai-sdk/openai-compatible" ||
      name === "@opencode/ai/providers/zai/chat" ||
      name === "@opencode/ai/providers/zai-coding-plan/chat")
  )
    return { settings: { thinking: { type: "enabled", clear_thinking: false } } }

  const kimi = [input.providerID, input.modelID, typeof input.baseURL === "string" ? input.baseURL : ""].some((value) =>
    /kimi|moonshot/iu.test(value),
  )
  if (
    kimi &&
    (name === "@ai-sdk/anthropic" ||
      name === "@ai-sdk/google-vertex/anthropic" ||
      name === "@opencode/ai/providers/anthropic" ||
      name === "@opencode/ai/providers/moonshot/messages" ||
      name === "@opencode/ai/providers/google-vertex/messages")
  )
    return { settings: { thinking: { type: "adaptive", display: "summarized" }, effort: "high" } }

  if (
    input.providerID === "alibaba-cn" &&
    !id.includes("kimi-k2-thinking") &&
    (name === "@ai-sdk/openai-compatible" || name === "@opencode/ai/providers/alibaba/chat")
  )
    return { settings: { enableThinking: true } }

  return undefined
}
