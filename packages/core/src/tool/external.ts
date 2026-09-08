export * as ExternalTools from "./external"

import { Ajv } from "ajv"
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
  return {
    register: (entries: Readonly<Record<string, ToolSpec>>) =>
      Effect.suspend(() =>
        tools.register(
          Object.fromEntries(
            Object.entries(entries).map(([name, spec]) => {
              const validate = validator.compile(spec.inputSchema)
              return [
                name,
                Tool.make({
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
                }),
              ]
            }),
          ),
        ),
      ),
  }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/ExternalTools") {}
export const layer = Layer.effect(Service, make)
export const node = makeLocationNode({ service: Service, layer, deps: [ToolRegistry.toolsNode, PermissionV2.node] })
