export * as IntelligenceEvent from "./intelligence-event.js"

import { ephemeral, inventory } from "./event.js"

export const SettingsUpdated = ephemeral({ type: "intelligence.settings.updated", schema: {} })
export const Definitions = inventory(SettingsUpdated)
