import { Show, type Component, type JSX } from "solid-js"
import { modelOrigin, routerKind, routerPath } from "./model-origin"

type InputKey = "text" | "image" | "audio" | "video" | "pdf"
type InputMap = Record<InputKey, boolean>

type ModelInfo = {
  id: string
  name: string
  provider: {
    id: string
    name: string
    router?: {
      kind: "red-router" | "9router"
    }
  }
  upstream?: {
    id: string
    name: string
    subscription?: boolean
  }
  via?: string
  capabilities?: {
    reasoning: boolean
    input: InputMap
  }
  modalities?: {
    input: Array<string>
  }
  reasoning?: boolean
  limit: {
    context: number
  }
}

function ModelTooltipRow(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-v2-text-text-muted">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right text-v2-text-text-base">{props.value}</span>
    </div>
  )
}

export const ModelTooltip: Component<{ model: ModelInfo; latest?: boolean; free?: boolean; v2?: boolean }> = (
  props,
) => {
  const sourceName = (model: ModelInfo) => {
    // A router names the provider that really serves the model; guessing from the id would call
    // every routed GPT or Codex model OpenAI.
    if (routerKind(model.provider)) return model.upstream?.name ?? model.provider.name
    const value = `${model.id} ${model.name}`.toLowerCase()

    if (/claude|anthropic/.test(value)) return "Anthropic"
    if (/gpt|o[1-4]|codex|openai/.test(value)) return "OpenAI"
    if (/gemini|palm|bard|google/.test(value)) return "Google"
    if (/grok|xai/.test(value)) return "xAI"
    if (/llama|meta/.test(value)) return "Meta"

    return model.provider.name
  }
  const inputLabel = (value: string) => {
    if (value === "text") return "text"
    if (value === "image") return "image"
    if (value === "audio") return "audio"
    if (value === "video") return "video"
    if (value === "pdf") return "pdf"
    return value
  }
  const title = () => {
    const tags: Array<string> = []
    if (props.latest) tags.push("Latest")
    if (props.free) tags.push("Free")
    const suffix = tags.length ? ` (${tags.join(", ")})` : ""
    return `${sourceName(props.model)} ${props.model.name}${suffix}`
  }
  const name = () => {
    const tags: Array<string> = []
    if (props.latest) tags.push("Latest")
    if (props.free) tags.push("Free")
    const suffix = tags.length ? ` (${tags.join(", ")})` : ""
    return `${props.model.name}${suffix}`
  }
  const inputs = () => {
    if (props.model.capabilities) {
      const input = props.model.capabilities.input
      const order: Array<InputKey> = ["text", "image", "audio", "video", "pdf"]
      const entries = order.filter((key) => input[key]).map((key) => inputLabel(key))
      return entries.length ? entries.join(", ") : undefined
    }
    const raw = props.model.modalities?.input
    if (!raw) return
    const entries = raw.map((value) => inputLabel(value))
    return entries.length ? entries.join(", ") : undefined
  }
  const reasoning = () => {
    if (props.model.capabilities)
      return props.model.capabilities.reasoning
        ? "Allows reasoning"
        : "No reasoning"
    return props.model.reasoning
      ? "Allows reasoning"
      : "No reasoning"
  }
  const connection = () => {
    const origin = modelOrigin(props.model)
    if (origin.type === "direct") return "direct"
    return [
      `via ${routerPath(origin)}`,
      ...(origin.subscription ? ["subscription"] : []),
    ].join(" · ")
  }
  const context = () => `Context limit ${props.model.limit.context.toLocaleString()}`
  const contextLimit = () => props.model.limit.context.toLocaleString("en")

  if (props.v2) {
    return (
      <div class="flex w-[180px] flex-col gap-2">
        <ModelTooltipRow name={"Model"} value={name()} />
        <ModelTooltipRow
          name={"Provider"}
          value={routerKind(props.model.provider) ? sourceName(props.model) : props.model.provider.name}
        />
        <ModelTooltipRow name={"Connection"} value={connection()} />
        <Show when={inputs()}>
          {(value) => <ModelTooltipRow name={"Inputs"} value={value()} />}
        </Show>
        <ModelTooltipRow name={"Reasoning"} value={reasoning()} />
        <ModelTooltipRow name={"Context"} value={contextLimit()} />
      </div>
    )
  }

  return (
    <div class="flex flex-col gap-1 py-1">
      <div class="text-13-medium">{title()}</div>
      <div class="text-12-regular text-text-invert-base">{connection()}</div>
      <Show when={inputs()}>
        {(value) => (
          <div class="text-12-regular text-text-invert-base">
            {`Allows: ${value()}`}
          </div>
        )}
      </Show>
      <div class="text-12-regular text-text-invert-base">{reasoning()}</div>
      <div class="text-12-regular text-text-invert-base">{context()}</div>
    </div>
  )
}
