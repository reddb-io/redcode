/**
 * Fake MCP servers for evals: in-memory transports, a small raw JSON-RPC client (other suites mock
 * the SDK client process-wide, so it cannot be relied on here), and a generated tracker server
 * wide enough to push its schemas over the tool_search threshold.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  CallToolRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  type Tool as MCPToolDef,
} from "@modelcontextprotocol/sdk/types.js"

export type ToolDef = MCPToolDef
export type Handler = (name: string, args: Record<string, unknown>) => string

export interface FakeServer {
  readonly name: string
  readonly tools: readonly ToolDef[]
  readonly handler?: Handler
}

export interface Connected {
  readonly name: string
  readonly defs: ToolDef[]
  readonly client: RawClient
  readonly calls: { tool: string; args: Record<string, unknown> }[]
}

class RawClient {
  private nextId = 1
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  constructor(private transport: InMemoryTransport) {}
  async connect() {
    this.transport.onmessage = (message) => {
      const msg = message as { id?: number; result?: unknown; error?: { message: string } }
      if (msg.id === undefined) return
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error.message))
      else entry.resolve(msg.result)
    }
    await this.transport.start()
    await this.request("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "redcode-eval", version: "1.0.0" },
    })
    await this.transport.send({ jsonrpc: "2.0", method: "notifications/initialized" })
  }
  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    void this.transport.send({ jsonrpc: "2.0", id, method, params } as never)
    return result
  }
  listTools() {
    return this.request("tools/list", {})
  }
  callTool(params: { name: string; arguments?: Record<string, unknown> }) {
    return this.request("tools/call", params)
  }
  getServerCapabilities() {
    return { tools: {} }
  }
}

export async function connect(input: FakeServer): Promise<Connected> {
  const calls: Connected["calls"] = []
  const server = new Server({ name: input.name, version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...input.tools] }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    calls.push({ tool: req.params.name, args })
    const text = input.handler ? input.handler(req.params.name, args) : `ok ${input.name}.${req.params.name}`
    return { content: [{ type: "text", text }] }
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new RawClient(clientTransport)
  await client.connect()
  const defs = (await client.listTools()).tools as ToolDef[]
  return { name: input.name, defs, client, calls }
}

const ENTITIES = ["issue", "project", "milestone", "label", "comment", "sprint", "board", "user"] as const
const VERBS = [
  ["create", "Create a new {e} in the tracker. Returns the created {e} with its id."],
  ["get", "Fetch a single {e} by id, including every field the tracker stores for it."],
  ["list", "List {e}s matching optional filters, paginated with cursor and limit."],
  ["update", "Update fields of an existing {e}; omitted fields keep their stored values."],
] as const

/** A project tracker with 34 tools: CRUD over eight entities plus close/reopen for issues. */
export function trackerServer(handler?: Handler): FakeServer {
  const tools: ToolDef[] = []
  for (const entity of ENTITIES)
    for (const [verb, text] of VERBS)
      tools.push({
        name: `${verb}_${entity}`,
        description: text.replaceAll("{e}", entity),
        inputSchema: {
          type: "object",
          properties: {
            ...(verb === "create" || verb === "list" ? {} : { id: { type: "number", description: `The ${entity} id` } }),
            ...(verb === "list"
              ? {
                  query: { type: "string", description: `Free text matched against ${entity} titles and bodies` },
                  cursor: { type: "string", description: "Opaque cursor returned by the previous page" },
                  limit: { type: "number", description: "Page size between 1 and 100" },
                }
              : {}),
            ...(verb === "create" || verb === "update"
              ? {
                  title: { type: "string", description: `Title of the ${entity}` },
                  body: { type: "string", description: `Markdown body of the ${entity}` },
                  assignee: { type: "string", description: "Login of the user responsible for it" },
                  labels: { type: "array", items: { type: "string" }, description: "Label names to attach" },
                }
              : {}),
          },
          ...(verb === "get" || verb === "update" ? { required: ["id"] } : {}),
        },
      })
  tools.push(
    {
      name: "close_issue",
      description: "Close an issue as completed or not planned, optionally leaving a closing comment.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "The issue id" },
          reason: { type: "string", enum: ["completed", "not_planned"], description: "Why the issue is closed" },
          comment: { type: "string", description: "A comment posted before closing" },
        },
        required: ["id"],
      },
    },
    {
      name: "reopen_issue",
      description: "Reopen a closed issue and optionally explain why in a comment.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "The issue id" },
          comment: { type: "string", description: "A comment posted when reopening" },
        },
        required: ["id"],
      },
    },
  )
  return { name: "tracker", tools, ...(handler ? { handler } : {}) }
}

export * as EvalMcp from "./mcp"
