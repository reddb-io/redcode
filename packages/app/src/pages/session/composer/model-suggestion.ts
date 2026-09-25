import { ModelSuggestion } from "@reddb-io/redcode-schema/model-suggestion"
import { routedName } from "@/components/model-origin"

type Ref = { readonly providerID: string; readonly modelID: string }

type ListedModel = Parameters<typeof routedName>[0]

/**
 * What the card shows for a suggestion, or undefined when it should not show: the model it would
 * replace is no longer the selected one, or the suggested model is not listed.
 */
export function suggestionCard(input: {
  readonly suggestion: ModelSuggestion.Info
  readonly selected: { readonly id: string; readonly provider: { readonly id: string } } | undefined
  readonly models: ReadonlyArray<ListedModel>
}) {
  const replaces = input.suggestion.current
  if (input.selected && (input.selected.provider.id !== replaces.providerID || input.selected.id !== replaces.modelID))
    return
  const target = input.suggestion.model
  const model = input.models.find((item) => item.id === target.modelID && item.provider.id === target.providerID)
  if (!model) return
  return {
    label: routedName(model),
    why: input.suggestion.whyText,
    deltas: ModelSuggestion.deltaParts(input.suggestion.delta).join(" · "),
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
