export * from "./client.js"
export * from "./server.js"

import { createRedcodeClient } from "./client.js"
import { createRedcodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createRedcode(options?: ServerOptions) {
  const server = await createRedcodeServer({
    ...options,
  })

  const client = createRedcodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
