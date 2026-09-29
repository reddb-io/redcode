import { RGBA, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { stringWidth } from "../../util/string-width"

export function PromptMetadataRow(props: {
  mode: "normal" | "shell"
  agent?: string
  auto: boolean
  model: string
  provider: string
  s1?: { model: string; provider: string }
  onS1Click?: () => void
  variant?: string
  muted: boolean
  highlight: RGBA
  agentAlpha: number
  modelAlpha: number
  variantAlpha: number
}) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => {
    if (props.mode === "shell") return { agent: props.agent ?? "Shell", model: "" }
    return promptMetadataLayout({
      width: Math.max(0, dimensions().width - (dimensions().width < 44 ? 9 : 13)),
      terminalWidth: dimensions().width,
      agent: props.agent ?? "",
      auto: props.auto,
      model: props.model,
      provider: props.provider,
      s1: props.s1,
      variant: props.variant,
    })
  })

  return (
    <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
      <Show
        when={(props.mode === "shell" || props.agent) && (layout().agent || layout().model)}
        fallback={<box height={1} />}
      >
        <Show when={layout().agent}>
          {(agent) => <text fg={fade(props.highlight, props.agentAlpha)}>{agent()}</text>}
        </Show>
        <Show when={props.mode === "normal" && layout().auto}>
          <text fg={fade(theme.text.muted, props.agentAlpha)}>auto</text>
        </Show>
        <Show when={props.mode === "normal" && layout().model}>
          <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
            <Show when={layout().agent}>
              <text fg={fade(theme.text.muted, props.modelAlpha)}>·</text>
            </Show>
            <text
              flexShrink={1}
              minWidth={0}
              wrapMode="none"
              truncate
              fg={fade(props.muted ? theme.text.muted : theme.text.base, props.modelAlpha)}
            >
              S2 {layout().model}
            </text>
            <Show when={layout().variant}>
              {(variant) => (
                <>
                  <text fg={fade(theme.text.muted, props.variantAlpha)}>·</text>
                  <text
                    fg={fade(theme.text.feedback.warning.base, props.variantAlpha)}
                    attributes={TextAttributes.BOLD}
                  >
                    {variant()}
                  </text>
                </>
              )}
            </Show>
            <Show when={layout().s1}>
              {(s1) => (
                <text flexShrink={0} fg={fade(theme.text.muted, props.modelAlpha)} onMouseUp={props.onS1Click}>
                  ⁄ S1 {s1()}
                </text>
              )}
            </Show>
          </box>
        </Show>
        <Show when={props.mode === "normal" && layout().route}>
          {(route) => (
            <text flexShrink={0} fg={fade(theme.text.muted, props.modelAlpha)}>
              {route()}
            </text>
          )}
        </Show>
      </Show>
    </box>
  )
}

function fade(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

type Layout = {
  agent?: string
  auto?: boolean
  model: string
  s1?: string
  route?: string
  variant?: string
}

function promptMetadataLayout(input: {
  width: number
  terminalWidth: number
  agent: string
  auto?: boolean
  model: string
  provider: string
  s1?: { model: string; provider: string }
  variant?: string
}) {
  const agent = input.terminalWidth < 44 ? undefined : input.agent
  const s1 = input.s1?.model
  const route =
    input.terminalWidth >= 100 ? [input.provider, input.s1?.provider].filter(Boolean).join(" · ") : undefined
  const candidates: Layout[] = [
    { agent, auto: input.auto, model: input.model, s1, variant: input.variant, route },
    { agent, model: input.model, s1, variant: input.variant, route },
    { agent, auto: input.auto, model: input.model, s1, variant: input.variant },
    { agent, model: input.model, s1, variant: input.variant },
    {
      agent,
      model: input.model,
      s1: s1 && Locale.truncateWidth(s1, input.terminalWidth < 70 ? 12 : 24),
      variant: input.variant,
    },
  ]
  const fit = candidates.find((candidate) => stringWidth(text(candidate)) <= input.width)
  if (fit) return fit

  const compact = s1 && Locale.truncateWidth(s1, 12)
  const prefix = agent ? `${agent} · S2 ` : "S2 "
  const suffix = compact ? ` ⁄ S1 ${compact}` : ""
  const showS1 = input.width - stringWidth(prefix) - stringWidth(suffix) >= 9
  return {
    agent,
    model: Locale.truncateWidth(
      input.model,
      Math.max(1, input.width - stringWidth(prefix) - (showS1 ? stringWidth(suffix) : 0)),
    ).replace(/\s+…$/, "…"),
    s1: showS1 ? compact : undefined,
  }
}

function text(input: Layout) {
  return [
    ...(input.agent ? [input.agent] : []),
    ...(input.auto ? ["auto"] : []),
    ...(input.model ? [...(input.agent ? ["·"] : []), "S2", input.model] : []),
    ...(input.variant ? ["·", input.variant] : []),
    ...(input.s1 ? ["⁄", "S1", input.s1] : []),
    ...(input.route ? [input.route] : []),
  ].join(" ")
}
