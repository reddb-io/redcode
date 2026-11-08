import { expect, test } from "bun:test"
import { createServer } from "node:net"
import { once } from "node:events"
import { Effect } from "effect"
import { BrowserTunnel } from "../src/tunnel.js"

test("private and reserved address classification is fail-closed", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.4", "::1", "fd00::1", "2001:db8::1"])
    expect(BrowserTunnel.publicAddress(address), address).toBe(false)
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])
    expect(BrowserTunnel.publicAddress(address), address).toBe(true)
})

test("tunnel rejects a private destination unless its exact host was approved", async () => {
  const server = createServer((socket) => socket.end())
  await once(server.listen(0, "127.0.0.1"), "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No TCP address")
  const denied = BrowserTunnel.make()
  const allowed = BrowserTunnel.make({
    allowPrivateTarget: (host, port) => host === "127.0.0.1" && port === address.port,
  })
  try {
    await expect(Effect.runPromise(denied.open({ host: "127.0.0.1", port: address.port }))).rejects.toThrow(
      "browser.network.private",
    )
    const otherPort = address.port === 65_535 ? address.port - 1 : address.port + 1
    await expect(Effect.runPromise(allowed.open({ host: "127.0.0.1", port: otherPort }))).rejects.toThrow(
      "browser.network.private",
    )
    const id = await Effect.runPromise(allowed.open({ host: "127.0.0.1", port: address.port }))
    await Effect.runPromise(allowed.close(id))
  } finally {
    denied.dispose()
    allowed.dispose()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
