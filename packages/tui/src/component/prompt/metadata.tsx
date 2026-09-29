import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { promptMetadataLayout, type PromptMetadataLayout } from "./metadata-layout"

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
  const layout = createMemo((): PromptMetadataLayout => {
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
          <Show when={layout().agent}>
            <text fg={fade(theme.text.muted, props.modelAlpha)}>·</text>
          </Show>
          <text
            flexShrink={0}
            wrapMode="none"
            fg={fade(props.muted ? theme.text.muted : theme.text.base, props.modelAlpha)}
          >
            {layout().model}
            <Show when={layout().variant}>
              {(variant) => (
                <span style={{ fg: fade(theme.text.formfield.selected, props.variantAlpha) }}>·{variant()}</span>
              )}
            </Show>
          </text>
          <Show when={layout().s1}>
            {(s1) => (
              <text
                flexShrink={0}
                wrapMode="none"
                fg={fade(theme.text.muted, props.modelAlpha)}
                onMouseUp={props.onS1Click}
              >
                ⁄ {s1()}
              </text>
            )}
          </Show>
        </Show>
        <Show when={props.mode === "normal" && layout().route}>
          {(route) => (
            <>
              <box flexGrow={1} />
              <text flexShrink={0} wrapMode="none" fg={fade(theme.text.muted, props.modelAlpha)}>
                {route()}
              </text>
            </>
          )}
        </Show>
      </Show>
    </box>
  )
}

function fade(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}
