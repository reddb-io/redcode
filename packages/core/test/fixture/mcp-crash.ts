import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const counter = Bun.file(process.argv[2])
const count = Number(await counter.text().catch(() => "0")) + 1
await Bun.write(counter, String(count))
const server = new Server({ name: "crashing-mcp", version: "1" }, { capabilities: { tools: {} } })
server.setRequestHandler("tools/list", () => {
  setTimeout(() => process.exit(1), 100)
  return Promise.resolve({ tools: [] })
})
await server.connect(new StdioServerTransport())
