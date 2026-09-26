import { readFileSync } from "node:fs"

export function promptVariant() {
  const variant = process.env.REDCODE_EVAL_PROMPT_VARIANT
  if (variant && variant !== "opus-focused") throw new Error(`Unknown eval prompt variant: ${variant}`)
  const model = process.env.REDCODE_EVAL_MODEL ?? ""
  const routerModel = model.startsWith("red-router/") ? model.slice("red-router/".length) : undefined
  return {
    ...(variant
      ? { agent: { build: { prompt: readFileSync(new URL("../variants/opus-focused.txt", import.meta.url), "utf8") } } }
      : {}),
    ...(process.env.REDCODE_EVAL_LIVE === "1" && routerModel
      ? {
          provider: {
            "red-router": {
              npm: "@ai-sdk/openai-compatible",
              options: { baseURL: process.env.REDCODE_EVAL_ROUTER_URL ?? "http://127.0.0.1:25050/v1" },
              models: { [routerModel]: { name: routerModel, limit: { context: 1_000_000, output: 128_000 } } },
            },
          },
        }
      : {}),
  }
}
