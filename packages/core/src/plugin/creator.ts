export * as CreatorPlugin from "./creator.js"

import { define } from "@opencode/plugin/effect/plugin"
import { CREATOR_INSTRUCTIONS } from "../creator-instructions.js"
import { apply } from "./creative-mode.js"

export const Plugin = define({
  id: "redcode.creator",
  effect: (ctx) =>
    apply(ctx, "creator", {
      name: "Creator",
      description:
        "Produce functional artifacts and Redcode extensions; verify and deliver previews, components, plugin/skill/MCP source or packages. Reuse Designer's document and contracts.",
      system: CREATOR_INSTRUCTIONS,
    }),
})
