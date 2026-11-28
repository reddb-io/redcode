export * as McpResourceTools from "./mcp-resource.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Hash } from "@opencode/util/hash"
import { Mcp } from "../../mcp/index.js"
import { Permission } from "../../permission.js"
import { PermissionSaved } from "../../permission/saved.js"
import { Location } from "../../location.js"

const skillAction = "opencode_load_mcp_skill"

export const Plugin = {
  id: "opencode.tools.mcp-resources",
  effect: Effect.fn("McpResourceTools.Plugin")(function* (ctx: Context) {
    const mcp = yield* Mcp.Service
    const permission = yield* Permission.Service
    const saved = yield* PermissionSaved.Service
    const location = yield* Location.Service

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "mcp_skill",
          options: { namespace: "opencode", codemode: true },
          description:
            "Discover or load a verified skill from an MCP server that opted into skills. List with only the server name. Load using the exact skill URI from the list. A new version requires user approval.",
          input: Schema.Struct({
            server: Schema.String,
            uri: Schema.optionalKey(Schema.String),
            file: Schema.optionalKey(Schema.String),
          }),
          output: Schema.Struct({
            skills: Schema.optionalKey(
              Schema.Array(Schema.Struct({ uri: Schema.String, name: Schema.String, description: Schema.String })),
            ),
            source: Schema.optionalKey(Schema.String),
            content: Schema.optionalKey(Schema.String),
          }),
          execute: (input, context) =>
            Effect.gen(function* () {
              const request = {
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool" as const, messageID: context.messageID, id: context.id },
              }
              const server = yield* mcp.skillServer(input.server)
              if (!input.uri) {
                yield* permission.assert({
                  ...request,
                  action: "opencode_list_mcp_resources",
                  resources: [input.server],
                  save: [input.server],
                  metadata: { server: input.server },
                })
                const skills = yield* server.skills.list()
                return {
                  output: {
                    skills: skills
                      .filter((skill) => skill.resources !== "dynamic")
                      .map((skill) => ({
                        uri: skill.uri,
                        name: skill.frontmatter.name,
                        description: skill.frontmatter.description,
                      })),
                  },
                }
              }
              const entry = yield* server.skills.get(input.uri)
              if (entry.resources === "dynamic")
                return yield* new ToolFailure({ message: "This MCP skill has no verifiable files" })
              const version = Hash.sha256(
                JSON.stringify([
                  server.identity,
                  entry.uri,
                  entry.frontmatter,
                  entry.resources
                    .map(({ uri, digest, size }) => [uri, digest, size])
                    .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
                ]),
              )
              const resource = `${input.server}:${version}`
              const grants = yield* saved.list({ projectID: location.project.id })
              const approved = grants.some((grant) => grant.action === skillAction && grant.resource === resource)
              yield* permission.assert({
                ...request,
                action: skillAction,
                resources: [resource],
                save: [resource],
                force: !approved,
                metadata: {
                  protected: "mcp-skill",
                  server: input.server,
                  name: entry.frontmatter.name,
                  uri: entry.uri,
                  version,
                },
              })
              const file = yield* server.skills.read(entry, input.file)
              const content = file.body ?? file.text
              if (!file.verified || content === undefined)
                return yield* new ToolFailure({ message: "The MCP skill file is not verified text" })
              return { output: { source: `${input.server}:${file.uri}`, content } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })
        editor.add({
          name: "list_mcp_resources",
          options: { namespace: "opencode", codemode: true },
          description:
            "List documents, records, and other data exposed by MCP servers. Use this when the user refers to something that is not a local file, such as a URI with a custom scheme, then load a match with read_mcp_resource. Each entry names the server to read it from. Templates are resources addressed by a parameter such as a record ID; fill in the uriTemplate placeholders before reading.",
          input: Schema.Struct({
            server: Schema.optionalKey(
              Schema.String.annotate({ description: "MCP server name as configured. Omit to list every server." }),
            ),
          }),
          output: Schema.Struct({
            resources: Schema.Array(Mcp.Resource),
            templates: Schema.Array(Mcp.ResourceTemplate),
          }),
          execute: (input, context) =>
            Effect.gen(function* () {
              // Listing every server checks each server name so per-server rules still apply.
              const servers =
                input.server === undefined ? (yield* mcp.servers()).map((server) => server.name) : [input.server]
              yield* permission.assert({
                action: "opencode_list_mcp_resources",
                resources: servers,
                save: servers,
                metadata: {},
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              if (input.server === undefined) return { output: yield* mcp.resourceCatalog() }
              return { output: yield* mcp.resources({ server: input.server }) }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })
        editor.add({
          name: "read_mcp_resource",
          options: { namespace: "opencode", codemode: true },
          description:
            "Read one MCP resource by server and URI. Not for local files. Always return the full contents rather than slicing or filtering them; oversized output is truncated automatically and the full content is saved to a file you can read. Images and PDFs are shown to you directly.",
          input: Schema.Struct({
            server: Schema.String.annotate({
              description: "The server field of the discovered resource.",
            }),
            uri: Schema.String.annotate({
              description: "Exact resource URI from discovery, an expanded uriTemplate, or the user.",
            }),
          }),
          output: Mcp.ResourceContent,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "opencode_read_mcp_resource",
                resources: [`${input.server}:${input.uri}`],
                save: [`${input.server}:*`],
                metadata: { server: input.server, uri: input.uri },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const resource = yield* mcp.readResource(input)
              if (!resource)
                return yield* new ToolFailure({
                  message: `MCP server "${input.server}" is not connected or does not expose resources`,
                })
              return {
                output: resource,
                content: resource.contents.flatMap((part) =>
                  part.type === "blob" && (part.mimeType?.startsWith("image/") || part.mimeType === "application/pdf")
                    ? [{ type: "file" as const, uri: `data:${part.mimeType};base64,${part.blob}`, mime: part.mimeType }]
                    : [],
                ),
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({
                      message: `Unable to read MCP resource ${input.server}:${input.uri}: ${error.message}`,
                      error,
                    }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
