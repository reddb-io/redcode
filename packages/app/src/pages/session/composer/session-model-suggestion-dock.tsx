import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { ModelSuggestion } from "@reddb-io/redcode-schema/model-suggestion"
import { Button } from "@reddb-io/redcode-ui/button"
import { DockTray } from "@reddb-io/redcode-ui/dock-surface"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import { answerSuggestion, suggestionCard } from "./model-suggestion"

/**
 * The session's pending model suggestion: `Suggest: <route> — <why>`, the deltas, and Switch / Keep.
 * Nothing switches until the person presses Switch.
 */
export function SessionModelSuggestionDock(props: { sessionID?: string }) {
  const sdk = useSDK()
  const local = useLocal()
  const [pending, setPending] = createSignal<ModelSuggestion.Info>()

  createEffect(() => {
    const sessionID = props.sessionID
    setPending(undefined)
    if (!sessionID) return
    const offSuggested = sdk().event.on("session.model.suggested", (event) => {
      if (event.properties.sessionID === sessionID) setPending(event.properties.suggestion)
    })
    const offResolved = sdk().event.on("session.model.suggestion.resolved", (event) => {
      if (event.properties.sessionID === sessionID && pending()?.trigger === event.properties.trigger)
        setPending(undefined)
    })
    onCleanup(() => {
      offSuggested()
      offResolved()
    })
  })

  const card = createMemo(() => {
    const suggestion = pending()
    if (!suggestion) return
    const view = suggestionCard({ suggestion, selected: local.model.current(), models: local.model.list() })
    if (!view) return
    const quota = view.quota ? `quota until ${view.quota}` : ""
    return { ...view, suggestion, details: [quota, view.deltas].filter(Boolean).join(" · ") }
  })

  const answer = (choice: ModelSuggestion.Choice) => {
    const current = card()
    const sessionID = props.sessionID
    if (!current || !sessionID) return
    setPending(undefined)
    void answerSuggestion({
      suggestion: current.suggestion,
      choice,
      select: (model) => local.model.set(model, { recent: true }),
      unavailable: () =>
        showToast({ title: `${current.label} is no longer available; kept the current model` }),
      resolve: (value) =>
        sdk()
          .client.modelSuggestion.resolve({ sessionID, ...value })
          .then((result) => result.data),
    })
  }

  return (
    <Show when={card()}>
      {(view) => (
        <DockTray data-component="session-model-suggestion-dock" class="mb-2">
          <div class="px-3 py-2 flex items-center gap-2" role="group" aria-label={view().label}>
            <div class="min-w-0 flex-1 flex flex-col">
              <span class="truncate text-13-medium text-text-strong">
                {`Suggest: ${view().label}`}
                <Show when={view().why}>
                  <span class="text-13-regular text-text-base"> — {view().why}</span>
                </Show>
              </span>
              <Show when={view().details}>
                <span class="truncate text-12-regular text-text-weak">{view().details}</span>
              </Show>
            </div>
            <Button size="small" variant="secondary" class="shrink-0" onClick={() => answer("switch")}>
              {"Switch"}
            </Button>
            <Button size="small" variant="ghost" class="shrink-0" onClick={() => answer("keep")}>
              {"Keep"}
            </Button>
          </div>
        </DockTray>
      )}
    </Show>
  )
}
