import type { ProviderRemoveResponses } from "@reddb-io/redcode-sdk/v2/client"

export type ProviderRemoval = ProviderRemoveResponses[200]

// Turns a dry-run result into the lines the confirm dialog shows: what goes away, then what stays behind.
export function providerRemoveSummary(result: ProviderRemoval, name: string) {
  const removed = [
    result.removed.credential && "Saved key or login",
    result.removed.config && "Configuration entry",
    result.removed.references.length > 0 && `In use by: ${result.removed.references.join(", ")}`,
    result.removed.learnedLimits > 0 && `Learned model limits: ${result.removed.learnedLimits}`,
  ].filter((line): line is string => typeof line === "string")
  return {
    removed: removed.length > 0 ? removed : ["Nothing is saved for this provider."],
    notes: [
      result.removed.hidden &&
        `${name} is hidden, since ${result.envVariables.join(", ")} would load it again. Connecting it again shows it.`,
      result.referencingFiles.length > 0 &&
        `Still mentioned in: ${result.referencingFiles.join(", ")}, which are not edited.`,
    ].filter((line): line is string => typeof line === "string"),
  }
}