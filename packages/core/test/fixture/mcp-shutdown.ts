import path from "node:path"
import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const [directory, name, peer] = process.argv.slice(2)
if (!directory || !name || !peer) throw new Error("Expected a directory and two server names")
// Both processes must receive EOF before either one exits. Sequential shutdown kills the first one.
const lifetime = setInterval(() => {}, 1_000)
process.stdin.on("end", async () => {
  await Bun.write(path.join(directory, `${name}.closed`), "closed")
  while (!(await Bun.file(path.join(directory, `${peer}.closed`)).exists())) await Bun.sleep(10)
  await Bun.write(path.join(directory, `${name}.clean`), "clean")
  clearInterval(lifetime)
})
const server = new Server({ name, version: "1.0.0" }, { capabilities: { tools: {} } })
server.setRequestHandler("tools/list", () => Promise.resolve({ tools: [] }))
await server.connect(new StdioServerTransport())
