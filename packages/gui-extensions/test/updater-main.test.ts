import { expect, setSystemTime, test } from "bun:test"
import { createServer } from "node:http"
import { Scope, type IpcImpl, type MainContext } from "../src/sdk/main"
import { Updater } from "../src/updater/contract"
import type definition from "../src/updater/index"
import setup from "../src/updater/main"
import { RELEASES_URL } from "../src/updater/release"

function unexpected(): never {
  throw new Error("Unexpected host operation")
}

function open(cache: { value: { until: number; data?: string } }) {
  const scope = Scope.make("updater-test", { timeout: 5000, log: unexpected })
  let provided: IpcImpl<typeof Updater.spec> | undefined
  const ctx: MainContext<typeof definition> = {
    id: "updater",
    scope,
    add: () => () => {},
    list: unexpected,
    t: (key) => key,
    plural: unexpected,
    stores: {
      releaseCache: {
        get value() {
          return cache.value
        },
        ready: () => true,
        update: unexpected,
        set: (value) => {
          cache.value = value
        },
      },
    },
    storage: { store: unexpected, remove: unexpected },
    log: { write: unexpected },
    lifecycle: { restart: unexpected },
    build: { version: "0.81.1", channel: "prod", platform: "desktop", packaged: true },
    serverEndpoints: { get: unexpected },
    windows: { get: unexpected, list: unexpected, focused: unexpected, on: unexpected },
    embeds: { create: unexpected },
    cli: {
      version: "0.81.1",
      command: [process.execPath],
      binary: process.execPath,
      development: false,
      installed: true,
    },
    provide(token, impl) {
      if (token !== Updater) return unexpected()
      // SAFETY: only the exact Updater token is accepted; it owns the captured implementation's spec.
      provided = impl as unknown as IpcImpl<typeof Updater.spec>
      return { changed: () => {}, emit: () => {}, dispose: () => {} }
    },
  }
  setup(ctx)
  if (!provided) return unexpected()
  const api = provided
  return { scope, read: (window: number) => api.releases(undefined, { window, signal: scope.signal }) }
}

test.each([200, 429, 403, 503])(
  "Desktop release IPC shares HTTP %i lookup and preserves its cache across reloads",
  async (status) => {
    const now = Date.now()
    let calls = 0
    let responseStatus = status
    const server = createServer((_request, response) => {
      calls++
      response.statusCode = responseStatus
      response.setHeader("content-type", "application/json")
      if (responseStatus === 429) response.setHeader("retry-after", "600")
      if (responseStatus === 403) {
        response.setHeader("x-ratelimit-remaining", "0")
        response.setHeader("x-ratelimit-reset", String(Math.ceil((now + 600_000) / 1000)))
      }
      response.end(JSON.stringify([{ tag_name: "v0.81.1" }]))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (typeof address === "string" || address === null) return unexpected()
    const base = globalThis.fetch
    // The production endpoint is fixed. Route its real GET to an owned HTTP fixture,
    // rather than adding a test-only URL setting or mocking response/backoff behavior.
    globalThis.fetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input instanceof Request ? input.url : String(input)).toBe(RELEASES_URL)
        return base(`http://127.0.0.1:${address.port}/releases`, init)
      },
      { preconnect: base.preconnect },
    )
    const cache = { value: { until: 0 } }
    const first = open(cache)
    let next: ReturnType<typeof open> | undefined
    try {
      const expected = status === 200 ? JSON.stringify([{ tag_name: "v0.81.1" }]) : null
      expect(await Promise.all(Array.from({ length: 8 }, (_, window) => first.read(window)))).toEqual(
        Array(8).fill(expected),
      )
      expect(calls).toBe(1)
      await first.scope.close()
      next = open(cache)
      expect(await next.read(9)).toBe(expected)
      expect(calls).toBe(1)
      const interval = status === 200 || status === 503 ? 300_000 : 600_000
      setSystemTime(new Date(now + interval - 1000))
      expect(await next.read(10)).toBe(expected)
      expect(calls).toBe(1)
      responseStatus = 200
      setSystemTime(new Date(now + interval + 1000))
      expect(await next.read(11)).toBe(JSON.stringify([{ tag_name: "v0.81.1" }]))
      expect(calls).toBe(2)
    } finally {
      await first.scope.close()
      await next?.scope.close()
      globalThis.fetch = base
      setSystemTime()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)
