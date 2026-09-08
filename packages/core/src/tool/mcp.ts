export * as MCPTools from "./mcp"

import path from "node:path"
import { Effect, Layer } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Config } from "../config"
import { Location } from "../location"
import { ExternalTools } from "./external"
import type { ToolSpec } from "@reddb-io/redcode-plugin/v2/effect"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* Config.Service
    const location = yield* Location.Service
    const tools = yield* ExternalTools.Service
    const settings = Config.latest(yield* config.entries(), "mcp")
    yield* Effect.forEach(
      Object.entries(settings?.servers ?? {}),
      ([name, server]) =>
        Effect.gen(function* () {
          if (server.disabled) return
          const { Client } = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/client/index.js"))
          const { StdioClientTransport } = yield* Effect.promise(
            () => import("@modelcontextprotocol/sdk/client/stdio.js"),
          )
          const { StreamableHTTPClientTransport } = yield* Effect.promise(
            () => import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
          )
          const client = yield* Effect.acquireRelease(
            Effect.succeed(new Client({ name: "redcode", version: "2" })),
            (client) => Effect.promise(() => client.close()).pipe(Effect.ignore),
          )
          const transport =
            server.type === "local"
              ? new StdioClientTransport({
                  command: server.command[0],
                  args: server.command.slice(1),
                  cwd: path.resolve(location.directory, server.cwd ?? "."),
                  env: {
                    ...Object.fromEntries(
                      Object.entries(process.env).filter(
                        (entry): entry is [string, string] => typeof entry[1] === "string",
                      ),
                    ),
                    ...server.environment,
                  },
                  stderr: "ignore",
                })
              : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
          // MCP is an intentional JSON-RPC boundary. Authentication belongs to the connected server.
          yield* Effect.tryPromise(() =>
            client.connect(transport, { timeout: server.timeout?.startup ?? settings?.timeout?.startup ?? 10000 }),
          )
          const listed = yield* Effect.tryPromise(async () => {
            const result = {
              tools: [] as Awaited<ReturnType<typeof client.listTools>>["tools"],
              cursor: undefined as string | undefined,
            }
            const seen = new Set<string>()
            do {
              const page = await client.listTools({ cursor: result.cursor })
              result.tools.push(...page.tools)
              result.cursor = page.nextCursor
              if (result.cursor && seen.has(result.cursor)) throw new Error("MCP tool listing repeated its cursor")
              if (result.cursor) seen.add(result.cursor)
            } while (result.cursor)
            return result
          })
          yield* tools.register(
            Object.fromEntries(
              listed.tools.map((tool) => [
                `mcp_${name}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
                {
                  description: tool.description ?? tool.name,
                  inputSchema: tool.inputSchema,
                  media: server.media?.[tool.name],
                  execute: async (input: unknown, context: { signal: AbortSignal }) => {
                    const result = await client.callTool(
                      {
                        name: tool.name,
                        arguments:
                          typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {},
                      },
                      undefined,
                      {
                        signal: context.signal,
                        timeout: server.timeout?.request ?? settings?.timeout?.request ?? 60000,
                      },
                    )
                    const content = Array.isArray(result.content) ? result.content : []
                    return {
                      isError: result.isError === true,
                      content: content.flatMap<Awaited<ReturnType<ToolSpec["execute"]>>["content"][number]>(
                        (part: unknown) => {
                          if (!part || typeof part !== "object" || !("type" in part)) return []
                          if (part.type === "text" && "text" in part && typeof part.text === "string")
                            return [{ type: "text" as const, text: part.text }]
                          if (
                            part.type === "image" &&
                            "data" in part &&
                            typeof part.data === "string" &&
                            "mimeType" in part &&
                            typeof part.mimeType === "string"
                          )
                            return [{ type: "image" as const, data: part.data, mimeType: part.mimeType }]
                          return []
                        },
                      ),
                    }
                  },
                },
              ]),
            ),
          )
        }).pipe(Effect.catch((error) => Effect.logWarning(`MCP ${name} unavailable`, error))),
      { concurrency: 4, discard: true },
    )
  }),
)

export const node = makeLocationNode({
  name: "tool/mcp",
  layer,
  deps: [Config.node, Location.node, ExternalTools.node],
})
