import { createMemo, createSignal, For, Show } from "solid-js"
import { ModelSuggestion } from "@reddb-io/redcode-schema/model-suggestion"
import { useEvent } from "../context/event"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { selectedForeground, useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { SplitBorder } from "../ui/border"
import { routedName } from "../util/model-origin"

type Ref = { readonly providerID: string; readonly modelID: string }

export const SWITCH_COMMAND = "model.suggestion.switch"
export const KEEP_COMMAND = "model.suggestion.keep"

/** The card's lines: what to switch to and why, then how it compares with the model in use. */
export function suggestionText(suggestion: ModelSuggestion.Info, label: string) {
  return {
    title: `Suggest: ${label}`,
    why: suggestion.whyText,
    deltas: ModelSuggestion.deltaParts(suggestion.delta).join(" · "),
  }
}

/**
 * Answers a suggestion. Only `switch` selects the suggested model; either answer goes to the server,
 * which drops the card on every client and, for `keep`, stops that trigger for the session.
 */
export function answerSuggestion(input: {
  readonly suggestion: ModelSuggestion.Info
  readonly choice: ModelSuggestion.Choice
  readonly select: (model: Ref) => void
  readonly resolve: (answer: {
    readonly trigger: ModelSuggestion.Trigger
    readonly choice: ModelSuggestion.Choice
  }) => Promise<unknown>
}) {
  if (input.choice === "switch") input.select(input.suggestion.model)
  return input.resolve({ trigger: input.suggestion.trigger, choice: input.choice }).catch(() => undefined)
}

/**
 * A compact card: `Suggest: <route> — <why>`, the deltas, and `switch` / `keep`. Both answers are
 * clickable and are commands (`/switch-model`, `/keep-model`, and in the palette), so the prompt keeps
 * its keys while the card is shown.
 */
export function ModelSuggestionView(props: {
  readonly suggestion: ModelSuggestion.Info
  readonly label: string
  readonly onAnswer: (choice: ModelSuggestion.Choice) => void
}) {
  const { theme } = useTheme()
  const text = createMemo(() => suggestionText(props.suggestion, props.label))
  const [hovered, setHovered] = createSignal<ModelSuggestion.Choice>()

  useBindings(() => ({
    commands: [
      {
        name: SWITCH_COMMAND,
        title: `Switch to suggested model: ${props.label}`,
        category: "Session",
        namespace: "palette",
        slashName: "switch-model",
        run: () => props.onAnswer("switch"),
      },
      {
        name: KEEP_COMMAND,
        title: "Keep the current model",
        category: "Session",
        namespace: "palette",
        slashName: "keep-model",
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
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.info}
      customBorderChars={SplitBorder.customBorderChars}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      marginBottom={1}
      flexShrink={0}
      gap={0}
    >
      <text fg={theme.text} wrapMode="word">
        {text().title}
        <span style={{ fg: theme.textMuted }}>{text().why ? ` — ${text().why}` : ""}</span>
      </text>
      <Show when={text().deltas}>
        <text fg={theme.textMuted}>{text().deltas}</text>
      </Show>
      <box flexDirection="row" gap={1} marginTop={1}>
        <For each={buttons}>
          {(button) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={hovered() === button.choice ? theme.info : theme.backgroundMenu}
              onMouseOver={() => setHovered(button.choice)}
              onMouseOut={() => setHovered(undefined)}
              onMouseUp={() => props.onAnswer(button.choice)}
            >
              <text fg={hovered() === button.choice ? selectedForeground(theme, theme.info) : theme.text}>
                {button.label}
              </text>
            </box>
          )}
        </For>
        <text fg={theme.textMuted}>{buttons.map((button) => button.hint).join(" · ")}</text>
      </box>
    </box>
  )
}

/**
 * The session's pending model suggestion, from the server's `session.model.suggested` events. The
 * card shows while the model it would replace is still the selected one and the suggested model is
 * listed, and hides (without being answered) while a permission or question takes the prompt's place.
 * Nothing switches until the person answers `switch`.
 */
export function ModelSuggestionCard(props: { readonly sessionID: string; readonly visible: boolean }) {
  const event = useEvent()
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  // The latest unanswered suggestion per session.
  const [pending, setPending] = createSignal<Readonly<Record<string, ModelSuggestion.Info>>>({})
  const drop = (sessionID: string) =>
    setPending((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== sessionID)))

  event.on("session.model.suggested", (evt) => {
    setPending((all) => ({ ...all, [evt.properties.sessionID]: evt.properties.suggestion }))
  })
  event.on("session.model.suggestion.resolved", (evt) => {
    if (pending()[evt.properties.sessionID]?.trigger === evt.properties.trigger) drop(evt.properties.sessionID)
  })

  const shown = createMemo(() => {
    const suggestion = pending()[props.sessionID]
    if (!props.visible || !suggestion) return
    const selected = local.model.current()
    const replaces = suggestion.current
    if (selected && (selected.providerID !== replaces.providerID || selected.modelID !== replaces.modelID)) return
    const provider = sync.data.provider.find((item) => item.id === suggestion.model.providerID)
    const model = provider?.models[suggestion.model.modelID]
    if (!provider || !model) return
    return { suggestion, label: routedName(provider, model) }
  })

  return (
    <Show when={shown()}>
      {(card) => (
        <ModelSuggestionView
          suggestion={card().suggestion}
          label={card().label}
          onAnswer={(choice) => {
            const suggestion = card().suggestion
            drop(props.sessionID)
            void answerSuggestion({
              suggestion,
              choice,
              select: (model) => local.model.set(model, { recent: true }),
              resolve: (answer) => sdk.client.modelSuggestion.resolve({ sessionID: props.sessionID, ...answer }),
            })
          }}
        />
      )}
    </Show>
  )
}
