import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { Effect, FileSystem, Schedule } from "effect"
import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { RemoteTunnel } from "../src/services/remote-tunnel"
import { ServiceConfig } from "../src/services/service-config"
import { RemoteAccessController } from "../src/services/remote-access"
import { httpsRelay } from "./fixture/https-relay"
import type { RemoteAccessHost } from "@opencode/server/remote-access"

test("HTTPS attaches without restarting the target, survives replacement failure and restores the saved connection", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-https-lifecycle-"))
  const one = await httpsRelay(root, "one")
  const two = await httpsRelay(root, "two")
  const failed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 503 }) })
  const target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      request.headers.get("authorization") === "Bearer fixture-host-secret"
        ? Response.json({ pid: process.pid })
        : new Response(null, { status: 401 }),
  })
  const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(
          Global.layerWith({
            home: root,
            data: path.join(root, "data"),
            config: path.join(root, "config"),
            state: path.join(root, "state"),
          }),
        ),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
  const settled = (host: RemoteAccessHost.Interface) =>
    Effect.sync(host.status).pipe(
      Effect.filterOrFail((value) => value.state === "ready" || value.state === "failed"),
      Effect.retry({ times: 1000, schedule: Schedule.spaced("10 millis") }),
    )
  let savedURL = ""
  try {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const controller = yield* RemoteAccessController.make(true)
          yield* controller.bind(target.url.host)
          yield* Effect.promise(() => controller.host.configure({ relay: one.api, acceptExposure: true }))
          const first = yield* settled(controller.host)
          expect(first.state).toBe("ready")
          expect(yield* Effect.promise(() => one.get(first.url!))).toEqual({
            status: 200,
            body: JSON.stringify({ pid: process.pid }),
          })
          yield* Effect.promise(() => controller.host.configure({ relay: one.api, acceptExposure: true }))
          expect(one.attached).toHaveLength(1)
          one.disconnect()
          yield* Effect.sync(controller.host.status).pipe(
            Effect.filterOrFail((value) => value.state === "connecting"),
            Effect.retry({ times: 500, schedule: Schedule.spaced("10 millis") }),
          )
          expect(yield* settled(controller.host)).toMatchObject({ state: "ready", url: first.url })
          expect(one.attached).toHaveLength(2)
          yield* Effect.promise(() => controller.host.configure({ relay: failed.url.origin, acceptExposure: true }))
          expect((yield* settled(controller.host)).state).toBe("failed")
          expect((yield* ServiceConfig.read()).relay).toBe(one.api)
          expect((yield* Effect.promise(() => one.get(first.url!))).status).toBe(200)
          yield* Effect.promise(() => controller.host.configure({ relay: two.api, acceptExposure: true }))
          const second = yield* settled(controller.host)
          expect(second.state).toBe("ready")
          savedURL = second.url!
          expect((yield* Effect.promise(() => two.get(savedURL))).status).toBe(200)
          yield* Effect.promise(() => controller.host.disable())
          expect((yield* ServiceConfig.read()).remote).toBeUndefined()
          expect(
            (yield* Effect.promise(() =>
              fetch(target.url, { headers: { authorization: "Bearer fixture-host-secret" } }),
            )).status,
          ).toBe(200)
          yield* Effect.promise(() => controller.host.configure({ relay: two.api, acceptExposure: true }))
          savedURL = (yield* settled(controller.host)).url!
        }),
      ),
    )
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const restored = yield* RemoteAccessController.make(true)
          yield* restored.bind(target.url.host)
          expect(yield* settled(restored.host)).toMatchObject({ state: "ready", url: savedURL })
          expect((yield* Effect.promise(() => two.get(savedURL))).status).toBe(200)
        }),
      ),
    )
    let standaloneURL = ""
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const standalone = yield* RemoteAccessController.make(false)
          yield* standalone.bind(target.url.host)
          expect(standalone.host.status().state).toBe("disabled")
          yield* Effect.promise(() => standalone.host.configure({ relay: one.api, acceptExposure: true }))
          standaloneURL = (yield* settled(standalone.host)).url!
          expect((yield* Effect.promise(() => one.get(standaloneURL))).status).toBe(200)
          expect((yield* ServiceConfig.read()).relay).toBe(two.api)
        }),
      ),
    )
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const standalone = yield* RemoteAccessController.make(false)
          yield* standalone.bind(target.url.host)
          expect(yield* settled(standalone.host)).toMatchObject({ state: "ready", url: standaloneURL })
          expect((yield* Effect.promise(() => one.get(standaloneURL))).status).toBe(200)
        }),
      ),
    )
  } finally {
    await one.close()
    await two.close()
    failed.stop(true)
    target.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("listener HTTPS setup requires consent, coalesces admission and preserves configuration on provisioning failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-listener-https-"))
  const requests: string[] = []
  const relay = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname)
      return Response.json({ message: "Unavailable fixture relay" }, { status: 503 })
    },
  })
  const original: ServiceConfig.Info = { password: "private-host-password", remoteAccepted: true }
  await Bun.write(path.join(root, "config", ServiceConfig.filename()), JSON.stringify(original))
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const controller = yield* RemoteAccessController.make(true)
          yield* controller.bind("127.0.0.1:4096")
          expect(controller.host.status()).toEqual({ available: true, state: "disabled" })
          expect(requests).toEqual([])
          yield* Effect.promise(async () => {
            await expect(
              controller.host.configure({ relay: relay.url.origin, acceptExposure: false as true }),
            ).rejects.toThrow("accepted")
            await expect(
              controller.host.configure({ relay: "http://insecure.example.test", acceptExposure: true }),
            ).rejects.toThrow("HTTPS")
          })
          expect(requests).toEqual([])
          const admitted = yield* Effect.promise(() =>
            controller.host.configure({ relay: relay.url.origin, acceptExposure: true }),
          )
          expect(admitted.state).toBe("provisioning")
          yield* Effect.promise(() => controller.host.configure({ relay: relay.url.origin, acceptExposure: true }))
          const failed = yield* Effect.sync(() => controller.host.status()).pipe(
            Effect.filterOrFail((value) => value.state === "failed"),
            Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }),
          )
          expect(failed).toMatchObject({ state: "failed", relay: relay.url.origin })
          expect(requests).toEqual(["/api/tunnel"])
          expect(yield* ServiceConfig.read()).toEqual(original)
          expect(controller.urls()).toEqual([])
          yield* Effect.promise(() => controller.host.disable())
          expect(controller.host.status().state).toBe("disabled")
          expect(yield* ServiceConfig.read()).toEqual(original)
        }),
      ).pipe(
        Effect.provide(
          Global.layerWith({
            home: root,
            data: path.join(root, "data"),
            config: path.join(root, "config"),
            state: path.join(root, "state"),
          }),
        ),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
  } finally {
    relay.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
}, 15_000)

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
    const original: ServiceConfig.Info = {
      remote: { route: "keep-route" },
      relay: one.url.origin,
      remoteAccepted: true,
    }
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
