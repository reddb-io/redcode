import { describe, expect, test } from "bun:test"
import { Rpc } from "@/util/rpc"

// A stand-in for the worker port: whatever the client posts is handed to the worker side,
// and whatever the worker posts comes back through the client's onmessage.
function pair(handlers: Record<string, (input: any) => any>) {
  let toClient: ((event: { data: string }) => void) | undefined
  const globals = globalThis as unknown as {
    onmessage?: (event: { data: string }) => void
    postMessage?: (data: string) => void
  }
  const previous = { onmessage: globals.onmessage, postMessage: globals.postMessage }
  globals.postMessage = (data: string) => toClient?.({ data })
  Rpc.listen(handlers)
  const workerReceive = globals.onmessage!

  const client = Rpc.client<any>({
    postMessage: (data: string) => void workerReceive({ data }),
    set onmessage(fn: any) {
      toClient = fn
    },
    get onmessage() {
      return toClient as any
    },
  } as any)

  return {
    client,
    restore() {
      globals.onmessage = previous.onmessage
      globals.postMessage = previous.postMessage
    },
  }
}

describe("Rpc", () => {
  test("returns a handler's result", async () => {
    const { client, restore } = pair({ echo: (input: string) => `${input}!` })
    expect(await client.call("echo", "hi")).toBe("hi!")
    restore()
  })

  test("a throwing handler rejects the caller instead of leaving it pending", async () => {
    const { client, restore } = pair({
      boom: () => {
        throw new Error("handler exploded")
      },
    })
    await expect(client.call("boom", undefined)).rejects.toThrow("handler exploded")
    restore()
  })

  test("an unknown method rejects rather than hanging", async () => {
    const { client, restore } = pair({})
    await expect(client.call("nope", undefined)).rejects.toThrow("Unknown RPC method: nope")
    restore()
  })

  test("fail() settles everything already waiting", async () => {
    const { client, restore } = pair({ stuck: () => new Promise(() => {}) })
    const first = client.call("stuck", undefined)
    const second = client.call("stuck", undefined)
    client.fail("server thread exited unexpectedly")
    await expect(first).rejects.toThrow("server thread exited unexpectedly")
    await expect(second).rejects.toThrow("server thread exited unexpectedly")
    // And calls made after the failure do not start waiting either.
    await expect(client.call("stuck", undefined)).rejects.toThrow("server thread exited unexpectedly")
    restore()
  })
})
