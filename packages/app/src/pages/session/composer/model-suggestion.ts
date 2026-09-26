import { ModelSuggestion } from "@reddb-io/redcode-schema/model-suggestion"
import { routedName } from "@/components/model-origin"

type Ref = { readonly providerID: string; readonly modelID: string }

type ListedModel = Parameters<typeof routedName>[0]

/**
 * What the card shows for a suggestion, or undefined when it should not show: the model it would
 * replace is no longer the selected one, or the suggested model is not listed. `quota` is the local
 * time the current model's exhausted quota resets, when known.
 */
export function suggestionCard(input: {
  readonly suggestion: ModelSuggestion.Info
  readonly selected: { readonly id: string; readonly provider: { readonly id: string } } | undefined
  readonly models: ReadonlyArray<ListedModel>
  readonly now?: number
}) {
  const replaces = input.suggestion.current
  if (input.selected && (input.selected.provider.id !== replaces.providerID || input.selected.id !== replaces.modelID))
    return
  const target = input.suggestion.model
  const model = input.models.find((item) => item.id === target.modelID && item.provider.id === target.providerID)
  if (!model) return
  const now = input.now ?? Date.now()
  const until = input.suggestion.until
  return {
    label: routedName(model),
    why: input.suggestion.whyText,
    quota: until !== undefined && until > now ? ModelSuggestion.clock(until, now) : undefined,
    deltas: ModelSuggestion.deltaParts(input.suggestion.delta).join(" · "),
  }
}

/**
 * Answers a suggestion. Either answer goes to the server, which drops the card on every client and,
 * for `keep`, stops that trigger for the session. Only `switch` selects the suggested model, after
 * the server has asked the router again: when it answers false the model became unusable since, and
 * nothing is selected. A server that cannot be reached does not stop the switch.
 */
export async function answerSuggestion(input: {
  readonly suggestion: ModelSuggestion.Info
  readonly choice: ModelSuggestion.Choice
  readonly select: (model: Ref) => void
  readonly unavailable: () => void
  readonly resolve: (answer: {
    readonly trigger: ModelSuggestion.Trigger
    readonly choice: ModelSuggestion.Choice
  }) => Promise<unknown>
}) {
  const answered = await input
    .resolve({ trigger: input.suggestion.trigger, choice: input.choice })
    .catch(() => undefined)
  if (input.choice !== "switch") return
  if (answered === false) return input.unavailable()
  input.select(input.suggestion.model)
}
