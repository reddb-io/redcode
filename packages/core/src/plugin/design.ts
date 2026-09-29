export * as DesignPlugin from "./design.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../agent.js"
import { DesignPrompt } from "../design/prompt.js"

export const Plugin = define({
  id: "redcode.design",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("design"), (item) => {
        item.name = Agent.Name.make("Design")
        item.description =
          "Build an interactive prototype for browser review and turn approved decisions into a Plan handoff."
        item.system = DesignPrompt.instructions
        item.mode = "primary"
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          ...[
            "read", "glob", "grep", "webfetch", "websearch", "skill", "question", "session_history",
            "design_*", "todo*", "goal_status", "goal_complete", "models",
          ].map((action) => ({ action, resource: "*", effect: "allow" as const })),
          { action: "read", resource: "*.env", effect: "ask" },
          { action: "read", resource: "*.env.*", effect: "ask" },
          { action: "read", resource: "*.env.example", effect: "allow" },
          { action: "subagent", resource: "explore", effect: "allow" },
          { action: "project_tooling", resource: "*", effect: "ask" },
          { action: "external_directory", resource: "*", effect: "ask" },
          { action: "external_directory", resource: "*/.red/code/design/*/work/*", effect: "allow" },
          { action: "edit", resource: ".red/code/design/*/work/*", effect: "allow" },
          { action: "edit", resource: "*/.red/code/design/*/work/*", effect: "allow" },
        )
      })
    })
  }),
})
