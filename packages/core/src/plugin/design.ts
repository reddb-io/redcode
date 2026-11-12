export * as DesignPlugin from "./design.js"

import { define } from "@opencode/plugin/effect/plugin"
import { DesignPrompt } from "../design/prompt.js"
import { DesignCollaboration } from "../design/collaboration.js"
import { apply } from "./creative-mode.js"

export const Plugin = define({
  id: "redcode.design",
  effect: (ctx) =>
    apply(ctx, "design", {
      name: "Design",
      description:
        "Design product experiences, review interface states and accessibility, and hand approved decisions to Plan. Collaborate with Creator on the same document.",
      system: `${DesignCollaboration.designer}\n\n${DesignPrompt.instructions}`,
    }),
})
