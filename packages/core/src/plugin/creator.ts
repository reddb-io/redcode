export * as CreatorPlugin from "./creator.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../agent.js"
import { CREATOR_INSTRUCTIONS } from "../creator-instructions.js"

export const Plugin = define({
  id: "redcode.creator",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("creator"), (item) => {
        item.name = Agent.Name.make("Creator")
        item.description =
          "Create interactive artifacts, 3D scenes, tools, skills and Redcode plugin source with tested previews."
        item.system = CREATOR_INSTRUCTIONS
        item.mode = "primary"
        // Creation uses the configured coding policy, including its existing edit and execution grants.
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
      })
    })
  }),
})
