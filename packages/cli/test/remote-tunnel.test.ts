import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { Effect, FileSystem } from "effect"
import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { RemoteTunnel } from "../src/services/remote-tunnel"
import { ServiceConfig } from "../src/services/service-config"

test("relay origins reject ambiguous or insecure remote addresses", () => {
  expect(RemoteTunnel.apiURL("https://relay.example.org:443/")).toBe("https://relay.example.org")
  expect(RemoteTunnel.apiURL("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080")
  for (const value of [
    "not a url",
    "http://relay.example.org",
    "https://user:secret@relay.example.org",
    "https://relay.example.org/api",
    "https://relay.example.org?token=secret",
    "https://relay.example.org/#secret",
    "file:///tmp/relay",
  ])
    expect(() => RemoteTunnel.apiURL(value)).toThrow()
})

test("selected relays receive their own identity, and failed replacement preserves the active configuration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-relay-selection-"))
  const requests: { relay: string; method: string; path: string; authorization: string | null }[] = []
  const serve = (name: string) =>
    Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const pathname = new URL(request.url).pathname
        requests.push({
          relay: name,
          method: request.method,
          path: pathname,
          authorization: request.headers.get("authorization"),
        })
        if (name === "failed") return Response.json({ message: "Unavailable fixture relay" }, { status: 503 })
        if (pathname === "/api/tunnel" && request.method === "POST")
          return Response.json(
            {
              tunnel: { id: name, hostname: `${name}.relay.test`, state: "offline" },
              token: `private-${name}`,
            },
            { status: 201 },
          )
        if (pathname.endsWith("/certificate"))
          return Response.json(
            {
              id: `cert-${name}`,
              state: {
                type: "ready",
                certificate: "fixture-certificate",
                chain: "",
                expiry: "2099-01-01T00:00:00Z",
              },
            },
            { status: request.method === "POST" ? 202 : 200 },
          )
        return new Response(null, { status: 404 })
      },
    })
  const one = serve("one")
  const two = serve("two")
  const failed = serve("failed")
  const data = path.join(root, "data")
  const config = path.join(root, "config")
  const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(Global.layerWith({ home: root, data, config, state: path.join(root, "state") })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
  try {
    const legacy = path.join(data, "opentunnel/default/token")
    await Bun.write(legacy, "legacy-private")
    expect(await run(RemoteTunnel.ensure(one.url.origin))).toBe("one.relay.test")
    expect(await run(RemoteTunnel.ensure(two.url.origin))).toBe("two.relay.test")
    const count = requests.length
    expect(await run(RemoteTunnel.ensure(one.url.origin))).toBe("one.relay.test")
    expect(requests).toHaveLength(count + 1)
    expect(requests.filter((r) => r.path === "/api/tunnel")).toHaveLength(2)
    expect(await run(RemoteTunnel.hostname("route-a", one.url.origin))).toBe("route-a.one.relay.test")
    expect(await run(RemoteTunnel.hostname("route-b", two.url.origin))).toBe("route-b.two.relay.test")
    expect(requests.filter((r) => r.path.endsWith("/certificate")).map((r) => r.authorization)).toEqual([
      "Bearer private-one",
      "Bearer private-one",
      "Bearer private-two",
      "Bearer private-two",
      "Bearer private-one",
    ])
    expect(await Bun.file(legacy).text()).toBe("legacy-private")
    const profiles = await fs.readdir(path.join(data, "connections/opentunnel"))
    expect(profiles).toHaveLength(2)
    expect(profiles).not.toContain("default")
    await run(ServiceConfig.set("relay", one.url.origin))
    expect(await run(ServiceConfig.get("relay"))).toBe(one.url.origin)
    await fs.mkdir(config, { recursive: true })
    const original: ServiceConfig.Info = { remote: { route: "keep-route" }, relay: one.url.origin, remoteAccepted: true }
    await Bun.write(path.join(config, ServiceConfig.filename()), JSON.stringify(original))
    await expect(run(ServiceConfig.enableRemote(failed.url.origin))).rejects.toThrow()
    expect(await run(ServiceConfig.read())).toEqual(original)
    expect(requests.filter((r) => r.relay === "failed").map((r) => r.authorization)).toEqual([null])
    await expect(run(ServiceConfig.set("relay", two.url.origin))).rejects.toThrow("switch an active relay")
    expect(await run(ServiceConfig.read())).toEqual(original)
  } finally {
    one.stop(true)
    two.stop(true)
    failed.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)
