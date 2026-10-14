import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"

if (process.argv[2]) appendFileSync(process.argv[2], "started\n")
const lines = createInterface({ input: process.stdin })
lines.on("line", (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  const result =
    request.method === "initialize"
      ? {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "owned-control-fixture", version: "1" },
        }
      : request.method === "tools/list"
        ? {
            tools: [
              {
                name: "observe",
                description: "Observe this owned fixture",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          }
        : request.method === "tools/call"
          ? { content: [{ type: "text", text: "owned fixture observed" }] }
          : {}
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n")
})
