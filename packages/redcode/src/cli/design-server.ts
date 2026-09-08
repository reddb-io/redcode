import { Rpc } from "@/util/rpc"
import { withTimeout } from "@/util/timeout"
import type { rpc } from "./tui/worker"
import { workerPath } from "./worker-path"

export async function start() {
  const worker = new Worker(await workerPath(), {
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      REDCODE_CLIENT: "tui",
    },
  })
  const client = Rpc.client<typeof rpc>(worker)
  worker.addEventListener("error", (event) => {
    client.fail(event instanceof ErrorEvent ? event.message : "Design server worker failed")
  })
  worker.addEventListener("close", () => client.fail("Design server worker exited"))
  const server = await withTimeout(
    client.call("server", { hostname: "127.0.0.1", port: 0 }),
    60000,
    "Design server startup timed out",
  ).catch((error) => {
    client.fail("Design server startup failed")
    worker.terminate()
    throw error
  })
  return {
    url: server.url,
    async close() {
      await withTimeout(client.call("shutdown", undefined), 5000).catch(() => {})
      client.fail("Design server stopped")
      worker.terminate()
    },
  }
}

export * as DesignServer from "./design-server"
