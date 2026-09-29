// A forced tool choice is `required` or a named tool. Models that refuse one answer it with a 400, so requests
// for them ask for the tool through `auto` instead, and structured output falls back to prompted JSON.
import { LLMRequest, ToolChoice } from "./schema/messages.js"

/**
 * Whether a model accepts a forced tool choice. `declared` is what the model's compatibility metadata says
 * (a router's parameters or the user's config) and wins when present. Without it, Claude Opus 5.5 and later
 * Opus models and the Fable and Mythos families refuse: they always think, and the API rejects a forced
 * tool choice for them. Gateway prefixes (`anthropic/`, `cc/`) and Bedrock or Vertex ids are recognized.
 */
export const supportsForcedToolChoice = (modelID: string, declared?: boolean) => {
  if (declared !== undefined) return declared
  const id = modelID.toLowerCase()
  if (!id.includes("claude-")) return true
  if (/(?:^|[^a-z])(?:fable|mythos)(?:[^a-z]|$)/.test(id)) return false
  const version = /claude-(?:([a-z]+)-)?(\d+)(?:[.-](\d{1,2}))?(?:-([a-z]+))?(?:[.@:-]|$)/.exec(id)
  if (!version || (version[1] ?? version[4]) !== "opus") return true
  const major = Number(version[2])
  return major < 5 || (major === 5 && Number(version[3] ?? 0) < 5)
}

/** Relax a forced tool choice to `auto` for a model that refuses one; the tools stay advertised. */
export const applyForcedToolChoicePolicy = (request: LLMRequest) => {
  const choice = request.toolChoice
  if (choice === undefined || (choice.type !== "required" && choice.type !== "tool")) return request
  if (supportsForcedToolChoice(request.model.id, request.model.compatibility?.forcedToolChoice)) return request
  return LLMRequest.update(request, {
    toolChoice: new ToolChoice({ type: "auto", disableParallelToolUse: choice.disableParallelToolUse }),
  })
}
