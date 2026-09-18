export * as ExternalTools from "./external"

import { Ajv, type ValidateFunction } from "ajv"
import { Context, Effect, Layer, Schema } from "effect"
import type { ToolSpec } from "@reddb-io/redcode-plugin/v2/effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

const make = Effect.gen(function* () {
  const tools = yield* Tools.Service
  const permissions = yield* PermissionV2.Service
  const validator = new Ajv({ strict: false, allErrors: true })
  const compile = (inputSchema: unknown): ValidateFunction | null => {
    if (typeof inputSchema !== "object" || inputSchema === null || Array.isArray(inputSchema)) return null
    // Servers advertise dialects the draft-07 Ajv build does not register (zod v4 emits
    // `$schema: .../draft/2020-12/schema`); the keywords used in tool inputs validate the same
    // under the default draft, so the advisory meta keys are dropped before compiling.
    const { $schema: _meta, $id: _id, ...rest } = inputSchema as Record<string, unknown>
    try {
      return validator.compile(rest)
    } catch {
      return null
    }
  }
  return {
    register: (entries: Readonly<Record<string, ToolSpec>>) =>
      Effect.gen(function* () {
        const prepared = Object.entries(entries).map(([name, spec]) => ({ name, spec, validate: compile(spec.inputSchema) }))
        const skipped = prepared.filter((entry) => entry.validate === null)
        if (skipped.length > 0)
          yield* Effect.logWarning("tool(s) skipped: input schema could not be compiled", {
            tools: skipped.map((entry) => entry.name),
          })
        yield* tools.register(
          Object.fromEntries(
            prepared
              .filter((entry): entry is typeof entry & { validate: ValidateFunction } => entry.validate !== null)
              .map(({ name, spec, validate }) => [
                name,
                Tool.external(Tool.make({
                  description: spec.description,
                  input: Schema.Unknown,
                  inputSchema: spec.inputSchema,
                  media: spec.media,
                  output: Schema.Struct({
                    content: Schema.Array(
                      Schema.Union([
                        Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
                        Schema.Struct({ type: Schema.Literal("image"), data: Schema.String, mimeType: Schema.String }),
                      ]),
                    ),
                  }),
                  execute: (input, context) =>
                    Effect.gen(function* () {
                      if (!validate(input))
                        return yield* new Tool.Failure({ message: validator.errorsText(validate.errors) })
                      yield* permissions
                        .assert({
                          action: name,
                          external: true,
                          sessionID: context.sessionID,
                          agent: context.agent,
                          resources: ["*"],
                          save: ["*"],
                          source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                        })
                        .pipe(Effect.mapError((error) => new Tool.Failure({ message: error.message })))
                      const result = yield* Effect.tryPromise({
                        try: (signal) => spec.execute(input, { sessionID: context.sessionID, signal }),
                        catch: (error) =>
                          new Tool.Failure({ message: error instanceof Error ? error.message : String(error) }),
                      })
                      if (result.isError)
                        return yield* new Tool.Failure({
                          message:
                            result.content
                              .filter((part) => part.type === "text")
                              .map((part) => part.text)
                              .join("\n") || "Connected tool failed",
                        })
                      return result
                    }),
                  toModelOutput: ({ output }) =>
                    output.content.map((part) =>
                      part.type === "text" ? part : { type: "file", data: part.data, mime: part.mimeType },
                    ),
                })),
              ]),
        ),
      )
    })
  }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/ExternalTools") {}
export const layer = Layer.effect(Service, make)
export const node = makeLocationNode({ service: Service, layer, deps: [ToolRegistry.toolsNode, PermissionV2.node] })
