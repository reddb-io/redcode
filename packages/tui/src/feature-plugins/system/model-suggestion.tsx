import { Plugin } from "@opencode/plugin/tui"
import { ModelSuggestion } from "@opencode/schema/model-suggestion"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useData } from "../../context/data"
import { useLocal } from "../../context/local"
import { useLocation } from "../../context/location"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { errorMessage } from "../../util/error"

export const SWITCH_COMMAND = "model.suggestion.switch"
export const KEEP_COMMAND = "model.suggestion.keep"

/**
 * The card's lines: what to switch to and why, then when the current model's quota resets and how
 * the suggestion compares with it.
 */
export function suggestionText(suggestion: ModelSuggestion.Info, label: string, now = Date.now()) {
  const quota = ModelSuggestion.quotaText(suggestion, now)
  return {
    title: `Suggest: ${label}`,
    why: suggestion.whyText,
    deltas: [...(quota ? [quota] : []), ...ModelSuggestion.deltaParts(suggestion.delta)].join(" · "),
  }
}

/**
 * Shows the session's pending RedRouter model suggestion above the composer while the model it would
 * replace is still selected and the suggested model is listed. `switch` selects the suggested model
 * in the prompt and switches the session to it, so a pending retry wait is retried on it; `keep`
 * stops that trigger for the session. Either answer drops the card on every client.
 */
export default Plugin.define({
  id: "redcode.model-suggestion",
  setup(context) {
    context.ui.slot({
      append: "session.composer.top",
      render: (input) => <ModelSuggestionCard context={context} sessionID={input.sessionID} />,
    })
  },
})

function ModelSuggestionCard(props: { readonly context: Plugin.Context; readonly sessionID: string }) {
  const data = useData()
  const local = useLocal()
  const location = useLocation()
  const shown = createMemo(() => {
    const suggestion = ModelSuggestion.read(data.session.get(props.sessionID)?.metadata).pending
    if (!suggestion) return undefined
    const selected = local.model.current()
    if (
      selected &&
      (selected.providerID !== suggestion.current.providerID || selected.modelID !== suggestion.current.id)
    )
      return undefined
    const model = data.location.model
      .list(location.ref)
      ?.find((item) => item.providerID === suggestion.model.providerID && item.id === suggestion.model.id)
    if (!model) return undefined
    return { suggestion, label: model.name || suggestion.name }
  })

  const answer = (choice: ModelSuggestion.Choice) => {
    const answered = ModelSuggestion.answer(data.session.get(props.sessionID)?.metadata, choice)
    if (!answered) return
    const failed = (error: unknown) => props.context.ui.toast.show({ variant: "error", message: errorMessage(error) })
    if (choice === "switch") {
      const model = answered.suggestion.model
      local.model.set({ providerID: model.providerID, modelID: model.id }, { recent: true })
      // Switching the session itself ends a pending retry wait, which is retried on the new model.
      void props.context.client.session
        .switchModel({ sessionID: props.sessionID, model: { providerID: model.providerID, id: model.id } })
        .catch(failed)
    }
    void props.context.client.session.update({ sessionID: props.sessionID, metadata: answered.metadata }).catch(failed)
  }

  return (
    <Show when={shown()}>
      {(card) => (
        <ModelSuggestionView
          context={props.context}
          suggestion={card().suggestion}
          label={card().label}
          onAnswer={answer}
        />
      )}
    </Show>
  )
}

/**
 * A compact card: `Suggest: <model> — <why>`, the deltas, and `switch` / `keep`. Both answers are
 * clickable and are commands (`/switch-model`, `/keep-model`, and in the palette), so the prompt keeps
 * its keys while the card is shown.
 */
export function ModelSuggestionView(props: {
  readonly context: Plugin.Context
  readonly suggestion: ModelSuggestion.Info
  readonly label: string
  readonly onAnswer: (choice: ModelSuggestion.Choice) => void
}) {
  const theme = useTheme()
  const text = createMemo(() => suggestionText(props.suggestion, props.label))
  const [hovered, setHovered] = createSignal<ModelSuggestion.Choice>()

  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: SWITCH_COMMAND,
        title: `Switch to suggested model: ${props.label}`,
        group: "Session",
        palette: true,
        slash: { name: "switch-model" },
        run: () => props.onAnswer("switch"),
      },
      {
        id: KEEP_COMMAND,
        title: "Keep the current model",
        group: "Session",
        palette: true,
        slash: { name: "keep-model" },
        run: () => props.onAnswer("keep"),
      },
    ],
  }))

  const buttons: ReadonlyArray<{ choice: ModelSuggestion.Choice; label: string; hint: string }> = [
    { choice: "switch", label: "switch", hint: "/switch-model" },
    { choice: "keep", label: "keep", hint: "/keep-model" },
  ]

  return (
    <box
      border={["left"]}
      borderColor={theme.text.feedback.info.base}
      customBorderChars={SplitBorder.customBorderChars}
      backgroundColor={theme.background.raised.base}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={1}
      marginBottom={1}
      flexShrink={0}
    >
      <text fg={theme.text.base} wrapMode="word">
        <span style={{ fg: theme.text.feedback.info.base }}>{text().title}</span>
        <span style={{ fg: theme.text.muted }}>{text().why ? ` — ${text().why}` : ""}</span>
      </text>
      <Show when={text().deltas}>
        <text fg={theme.text.muted}>{text().deltas}</text>
      </Show>
      <box flexDirection="row" gap={1} marginTop={1}>
        <For each={buttons}>
          {(button) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                hovered() === button.choice
                  ? theme.background.action.secondary.hovered
                  : theme.background.action.secondary.base
              }
              onMouseOver={() => setHovered(button.choice)}
              onMouseOut={() => setHovered(undefined)}
              onMouseUp={() => props.onAnswer(button.choice)}
            >
              <text
                fg={
                  hovered() === button.choice ? theme.text.action.secondary.hovered : theme.text.action.secondary.base
                }
              >
                {button.label}
              </text>
            </box>
          )}
        </For>
        <text fg={theme.text.muted}>{buttons.map((button) => button.hint).join(" · ")}</text>
      </box>
    </box>
  )
}
