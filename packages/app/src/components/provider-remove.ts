import type { ProviderRemoveResponses } from "@reddb-io/redcode-sdk/v2/client"

export type ProviderRemoval = ProviderRemoveResponses[200]

type ProviderRemoveKey =
  | "provider.remove.credential"
  | "provider.remove.config"
  | "provider.remove.references"
  | "provider.remove.learnedLimits"
  | "provider.remove.nothing"
  | "provider.remove.env"
  | "provider.remove.files"

// Turns a dry-run result into the lines the confirm dialog shows: what goes away, then what stays behind.
export function providerRemoveSummary(
  result: ProviderRemoval,
  name: string,
  t: (key: ProviderRemoveKey, vars?: Record<string, string | number>) => string,
) {
  const removed = [
    result.removed.credential && t("provider.remove.credential"),
    result.removed.config && t("provider.remove.config"),
    result.removed.references.length > 0 &&
      t("provider.remove.references", { references: result.removed.references.join(", ") }),
    result.removed.learnedLimits > 0 && t("provider.remove.learnedLimits", { count: result.removed.learnedLimits }),
  ].filter((line): line is string => typeof line === "string")
  return {
    removed: removed.length > 0 ? removed : [t("provider.remove.nothing")],
    notes: [
      result.envVariables.length > 0 &&
        t("provider.remove.env", { provider: name, variables: result.envVariables.join(", ") }),
      result.referencingFiles.length > 0 && t("provider.remove.files", { files: result.referencingFiles.join(", ") }),
    ].filter((line): line is string => typeof line === "string"),
  }
}
