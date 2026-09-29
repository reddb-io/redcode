import { createMemo, Show } from "solid-js"
import { ModelSuggestion } from "@opencode/schema/model-suggestion"
import { Button } from "@opencode/ui/button"
import type { ModelSelection } from "@/providers/models/selection"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { useCommand } from "@/shell/commands/command"
import { showToast } from "@/shell/notifications/toast"

/**
 * The session's pending RedRouter model suggestion, shown above the composer while the model it would
 * replace is still selected and the suggested model is listed. `switch` selects the suggested model
 * through the composer's normal model selection; `keep` stops that trigger for the session. Either
 * answer drops the card on every client, as in the terminal.
 */
export function SessionModelSuggestionCard(props: { sessionID: string; selection: ModelSelection }) {
  const command = useCommand()
  const data = useData()
  const language = useLanguage()
  const server = useServerSDK()
  const shown = createMemo(() => {
    const suggestion = ModelSuggestion.read(data.session.get(props.sessionID)?.metadata).pending
    if (!suggestion) return undefined
    const selected = props.selection.current()
    if (selected && (selected.provider.id !== suggestion.current.providerID || selected.id !== suggestion.current.id))
      return undefined
    const model = props.selection
      .list()
      .find((item) => item.provider.id === suggestion.model.providerID && item.id === suggestion.model.id)
    if (!model) return undefined
    const quota = ModelSuggestion.quotaText(suggestion)
    return {
      label: model.name || suggestion.name,
      why: suggestion.whyText,
      deltas: [...(quota ? [quota] : []), ...ModelSuggestion.deltaParts(suggestion.delta)].join(" · "),
    }
  })

  const answer = (choice: ModelSuggestion.Choice) => {
    const answered = ModelSuggestion.answer(data.session.get(props.sessionID)?.metadata, choice)
    if (!answered) return
    if (choice === "switch")
      props.selection.set(
        { providerID: answered.suggestion.model.providerID, modelID: answered.suggestion.model.id },
        { recent: true },
      )
    void server.api.session.update({ sessionID: props.sessionID, metadata: answered.metadata }).catch((error) =>
      showToast({
        title: language.t("session.modelSuggestion.failed"),
        description: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  command.register("session.model-suggestion", () => [
    {
      id: "model.suggestion.switch",
      title: language.t("session.modelSuggestion.switch.command", { model: shown()?.label ?? "" }),
      category: language.t("command.category.session"),
      slash: "switch-model",
      disabled: !shown(),
      onSelect: () => answer("switch"),
    },
    {
      id: "model.suggestion.keep",
      title: language.t("session.modelSuggestion.keep.command"),
      category: language.t("command.category.session"),
      slash: "keep-model",
      disabled: !shown(),
      onSelect: () => answer("keep"),
    },
  ])

  return (
    <Show when={shown()}>
      {(card) => (
        <div
          data-component="session-model-suggestion"
          role="status"
          class="mb-2 flex min-w-0 flex-col gap-2 rounded-xl bg-v2-background-bg-base px-3 py-2.5 shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
        >
          <div class="min-w-0 text-13-regular text-v2-text-text-base">
            <span class="font-[530] text-v2-text-text-accent">
              {language.t("session.modelSuggestion.title", { model: card().label })}
            </span>
            <Show when={card().why}>
              <span class="text-v2-text-text-muted"> — {card().why}</span>
            </Show>
          </div>
          <Show when={card().deltas}>
            <div class="text-12-regular text-v2-text-text-muted">{card().deltas}</div>
          </Show>
          <div class="flex items-center gap-2">
            <Button size="small" variant="submit" onClick={() => answer("switch")}>
              {language.t("session.modelSuggestion.switch")}
            </Button>
            <Button size="small" variant="ghost" onClick={() => answer("keep")}>
              {language.t("session.modelSuggestion.keep")}
            </Button>
          </div>
        </div>
      )}
    </Show>
  )
}
