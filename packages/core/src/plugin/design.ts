export * as DesignPlugin from "./design.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../agent.js"
import { DesignPlaybooks } from "../design/playbooks.js"

const instructions = `You are in Design mode. Build an interactive prototype for review, then turn the user's decisions into a Plan handoff.

Start with design_document list or detect when needed. Create a Design document before editing and edit only its returned prototype root. Preserve the existing product implementation. Use design_playbook for every relevant playbook before writing the prototype. ${DesignPlaybooks.ROUTER}

Use design_media to inspect explicitly declared image tools and design_generate to import their inline results as versioned assets when the design needs new imagery. Publish coherent revisions with design_preview. Review rendered output with design_export and design_jobs, including narrow and wide layouts where relevant. Incorporate browser feedback in the same Design document, verify each feedback round, and record each note's outcome. Never treat automated checks as user approval.

Use design_exit only after a reviewable revision is published and the user explicitly approves it. Approval is recorded in the same Session and continues in Plan unless the active goal stops after Design. Do not modify product files in Design mode. To implement product code, switch to Build after Plan. Follow the user's scope and ask focused questions when a design decision is unresolved.`

export const Plugin = define({
  id: "redcode.design",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("design"), (item) => {
        item.name = Agent.Name.make("Design")
        item.description =
          "Build an interactive prototype for browser review and turn approved decisions into a Plan handoff."
        item.system = instructions
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
