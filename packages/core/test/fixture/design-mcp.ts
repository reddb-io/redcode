import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const server = new Server({ name: "design-fixture", version: "1" }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async (request) =>
  request.params?.cursor !== "images"
    ? {
        tools: [{ name: "status", description: "Connection status", inputSchema: { type: "object" } }],
        nextCursor: "images",
      }
    : {
        tools: [
          {
            name: "create_image",
            description: "Local image fixture",
            inputSchema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } },
          },
        ],
      },
)
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: "text", text: "Fixture connected" }],
}))
await server.connect(new StdioServerTransport())
