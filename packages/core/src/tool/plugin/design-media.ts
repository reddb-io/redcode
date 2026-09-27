export * as DesignMediaTool from "./design-media.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Design } from "@opencode/schema/design"
import { Effect, Schema } from "effect"
import { Config } from "../../config.js"
import { DesignStore } from "../../design/store.js"
import { Mcp } from "../../mcp/index.js"
import { Permission } from "../../permission.js"
import { McpTool } from "../mcp.js"

export const Plugin = {
  id: "redcode.tool.design-media",
  effect: Effect.fn("DesignMediaTool.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const designs = yield* DesignStore.Service
    const mcp = yield* Mcp.Service
    const permission = yield* Permission.Service

    const declared = Effect.fn("DesignMediaTool.declared")(function* () {
      return new Map(
        (yield* config.entries()).flatMap((entry) =>
          entry.type === "document" ? Object.entries(entry.info.mcp?.servers ?? {}) : [],
        ),
      )
    })

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "design_media",
          options: { codemode: false },
          description:
            "List connected MCP tools with explicitly declared image capabilities and their argument schemas.",
          input: Schema.Struct({}),
          output: Schema.String,
          execute: (_input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "design_media",
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const servers = yield* declared()
              const tools = yield* mcp.tools()
              const output =
                tools
                  .flatMap((tool) => {
                    const capability = servers.get(tool.server)?.media?.[tool.name]
                    return capability
                      ? [
                          `${McpTool.name(tool.server, tool.name)}: ${capability.operations.join(", ")}; ${capability.formats.join(", ")}; transparency ${capability.transparency}\nArguments (MCP JSON Schema): ${JSON.stringify(tool.inputSchema ?? {})}`,
                        ]
                      : []
                  })
                  .join("\n\n") ||
                "No image-capable MCP tools are connected. Add explicit media declarations to a server's MCP configuration, or import an image with design_asset."
              return { output, content: output }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })

        editor.add({
          name: "design_generate",
          options: { codemode: false },
          description:
            "Call one connected MCP image tool using its advertised arguments and import inline images as versioned Design assets.",
          input: Schema.Struct({
            id: Design.ID,
            tool: Schema.String,
            arguments: Schema.Record(Schema.String, Schema.Unknown),
            operation: Schema.Literals(["generate", "edit", "reference"]),
            parent: Schema.optional(Schema.String),
          }),
          output: Schema.Array(Design.Asset),
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* designs.get(context.sessionID, input.id)
              const servers = yield* declared()
              const tool = (yield* mcp.tools()).find(
                (item) => McpTool.name(item.server, item.name) === input.tool,
              )
              if (!tool)
                return yield* new Design.Error({ code: "unavailable", message: "The image tool is disconnected" })
              const capability = servers.get(tool.server)?.media?.[tool.name]
              if (!capability?.operations.includes(input.operation))
                return yield* new Design.Error({
                  code: "invalid",
                  message: "This tool does not declare the requested image operation",
                })
              yield* permission.assert({
                action: "design_generate",
                resources: [input.id],
                save: [input.id],
                force: true,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
                metadata: { tool: input.tool, operation: input.operation },
              })
              const result = yield* mcp.callTool({
                server: tool.server,
                name: tool.name,
                args: input.arguments,
                sessionID: context.sessionID,
              })
              if (result.isError)
                return yield* new Design.Error({
                  code: "unavailable",
                  message: "Image generation failed; inspect the connected tool and retry explicitly",
                })
              const assets = yield* Effect.forEach(
                result.content.filter((part) => part.type === "media").filter((part) => part.mimeType.startsWith("image/")),
                (part) =>
                  Schema.decodeUnknownEffect(Design.ImportAsset)({
                    name: `generated.${part.mimeType.split("/")[1]?.replace("svg+xml", "svg") ?? "png"}`,
                    mime: part.mimeType,
                    data: part.data,
                    source: input.tool,
                    parent: input.parent,
                  }).pipe(Effect.flatMap((asset) => designs.importAsset(context.sessionID, input.id, asset))),
              )
              const content = assets.length
                ? assets.map((asset) => `Asset ${asset.id}: assets/${asset.id}-${asset.name}`).join("\n")
                : "The image tool returned no inline image. Import its local output using design_asset."
              return { output: assets, content, metadata: { designID: input.id, assets: assets.map((asset) => asset.id) } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })
      })
      .pipe(Effect.orDie)
  }),
}
