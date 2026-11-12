export * as CreatorComponentTool from "./creator-component.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { CreatorComponent } from "@opencode/schema/creator-component"
import { Design } from "@opencode/schema/design"
import { Effect, Schema } from "effect"
import { CreatorComponents } from "../../creator/component.js"
import { DesignStore } from "../../design/store.js"
import { DesignCollaboration } from "../../design/collaboration.js"
import { Permission } from "../../permission.js"

export const Input = Schema.Union([
  Schema.Struct({ action: Schema.Literal("list") }),
  Schema.Struct({ action: Schema.Literal("inspect"), id: CreatorComponent.ID }),
  Schema.Struct({
    action: Schema.Literal("install"),
    designID: Design.ID,
    revision: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    description: Schema.optional(Schema.String),
  }),
  Schema.Struct({ action: Schema.Literal("update"), id: CreatorComponent.ID, ...CreatorComponent.Update.fields }),
  Schema.Struct({
    action: Schema.Literals(["enable", "disable"]),
    id: CreatorComponent.ID,
    expectedVersion: CreatorComponent.Remove.fields.expectedVersion,
  }),
  Schema.Struct({ action: Schema.Literal("remove"), id: CreatorComponent.ID, ...CreatorComponent.Remove.fields }),
])

export const Plugin = {
  id: "redcode.tool.creator-component",
  effect: Effect.fn("CreatorComponentTool.Plugin")(function* (ctx: Context) {
    const components = yield* CreatorComponents.Service
    const designs = yield* DesignStore.Service
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: "creator_component",
          options: { codemode: false },
          description:
            "Install an immutable published Design revision as a persistent isolated Creator panel in this project, list or inspect installations, update with expectedVersion, enable/disable or remove them. This installs renderer-only components, never trusted host plugins. Mutations request explicit permission; an update builds before replacing the active revision. Removal preserves source documents and files. Components appear in desktop/web Creator; the TUI can manage them and read metadata but does not render HTML.",
          input: Input,
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              const read = input.action === "list" || input.action === "inspect"
              const resources = [input.action === "install" ? input.designID : "id" in input ? input.id : "*"]
              const action = read ? "creator_component" : "creator_component_edit"
              const invocation = { sessionID: context.sessionID, agent: context.agent, action, resources }
              yield* permission.assert({
                ...invocation,
                force: read ? false : !(yield* permission.explicit(invocation)),
                save: read ? [] : resources,
                metadata: { operation: input.action, ...("revision" in input ? { revision: input.revision } : {}) },
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const result = yield* Effect.gen(function* () {
                if (input.action === "install" || input.action === "update") {
                  const origin =
                    input.action === "install"
                      ? { sessionID: context.sessionID, designID: input.designID }
                      : yield* components.get(input.id)
                  const document = yield* designs.get(origin.sessionID, origin.designID)
                  const assigned = DesignCollaboration.author(document, context.agent)
                  if (assigned) return yield* new Design.Error({ code: "conflict", message: assigned })
                }
                if (input.action === "list") return yield* components.list()
                if (input.action === "inspect") return yield* components.get(input.id)
                if (input.action === "install")
                  return yield* components.install({
                    sessionID: context.sessionID,
                    designID: input.designID,
                    revision: input.revision,
                    name: input.name,
                    description: input.description,
                  })
                if (input.action === "update") return yield* components.update(input.id, input)
                if (input.action === "enable" || input.action === "disable")
                  return yield* components.control(input.id, {
                    expectedVersion: input.expectedVersion,
                    enabled: input.action === "enable",
                  })
                yield* components.remove(input.id, input)
                return { removed: input.id, sourcesPreserved: true }
              })
              const output = JSON.stringify(result)
              return { output, content: output }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
