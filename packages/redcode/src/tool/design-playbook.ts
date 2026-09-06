import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./design-playbook.txt"
import { DesignPlaybooks } from "@/design/playbooks"

export const Parameters = Schema.Struct({
  id: Schema.optional(Schema.String).annotate({
    description: "Which playbook: diagram, table, comparison, plan, code, input or slides. Omit to list them.",
  }),
})

/**
 * Guidance on demand. The prompt carries the router; the playbook itself is read on the turn that
 * needs it, so the mode's prompt stays short and the tokens are spent when they buy something.
 */
export const DesignPlaybookTool = Tool.define(
  "design_playbook",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: typeof Parameters.Type) =>
        Effect.gen(function* () {
          const id = params.id?.trim()
          if (!id) {
            return {
              title: "Design playbooks",
              metadata: { ids: DesignPlaybooks.ids() },
              output: DesignPlaybooks.list(),
            }
          }
          const playbook = DesignPlaybooks.find(id)
          if (!playbook) {
            throw new Error(`Unknown playbook "${id}". Known: ${DesignPlaybooks.ids().join(", ")}.`)
          }
          return {
            title: `Playbook: ${playbook.id}`,
            metadata: { ids: [playbook.id] },
            output: DesignPlaybooks.render(playbook),
          }
        }),
    }
  }),
)

export * as DesignPlaybook from "./design-playbook"
