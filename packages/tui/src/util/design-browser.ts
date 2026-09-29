import type { ConfigEntry } from "@opencode/client"

/** The `design.browser` setting of the most specific configuration document that sets it. */
export function configuredDesignBrowser(entries: readonly ConfigEntry[]) {
  return entries
    .filter((entry): entry is Extract<ConfigEntry, { type: "document" }> => entry.type === "document")
    .findLast((entry) => typeof entry.info.design?.browser === "string")?.info.design?.browser
}
