import type { ReasoningChoice } from "./state"
import type { IntelligenceLabel } from "@opencode/util/intelligence-label"

export const reasoningChoices = ["default", "single", "observe", "dual"] as const satisfies readonly ReasoningChoice[]

export const reasoningChoiceKeys = {
  default: "composer.reasoning.option.default",
  single: "composer.reasoning.option.single",
  observe: "composer.reasoning.option.observe",
  dual: "composer.reasoning.option.dual",
} as const

// The same words as the TUI footer (`IntelligenceLabel.labels`).
export const stateKeys = {
  offline: "composer.reasoning.state.offline",
  setup: "composer.reasoning.state.setup",
  observing: "composer.reasoning.state.observing",
  unavailable: "composer.reasoning.state.unavailable",
  unsure: "composer.reasoning.state.unsure",
  flagged: "composer.reasoning.state.flagged",
} as const satisfies Record<IntelligenceLabel.State, string>
