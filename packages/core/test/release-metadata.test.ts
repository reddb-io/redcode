import { expect, setSystemTime, test } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { ReleaseMetadata } from "@opencode/core/release-metadata"
import { Global } from "@opencode/util/global"
import { tmpdir } from "./fixture/tmpdir"

function request(root: string, urls: string[]) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const releases = yield* ReleaseMetadata.Service
      return yield* Effect.all(
        urls.map((url) => releases.get(url)),
        { concurrency: "unbounded" },
      )
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(ReleaseMetadata.node, [
          Global.node.replace(Global.layerWith({ state: path.join(root, "state") })),
          Database.node.replace(Database.configured({ path: path.join(root, "cache.sqlite") })),
        ]),
      ),
      Effect.scoped,
    ),
  )
}

test("release lookups coalesce concurrent requests and persist metadata across recreation", async () => {
  await using dir = await tmpdir()
  let calls = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      calls++
      return Response.json({ tag_name: "v1", assets: [] })
    },
  })
  try {
    const url = `${server.url}releases/latest`
    expect(
      await request(
        dir.path,
        Array.from({ length: 8 }, () => url),
      ),
    ).toHaveLength(8)
    expect(await request(dir.path, [url])).toEqual([{ tag_name: "v1", assets: [] }])
    expect(calls).toBe(1)
    setSystemTime(new Date(Date.now() + 60 * 60_000 + 1000))
    await request(dir.path, [url])
    expect(calls).toBe(2)
  } finally {
    setSystemTime()
    await server.stop(true)
  }
})

test.each(["seconds", "date", "reset", "fallback"] as const)(
  "GitHub rate limits stop other release requests until %s cooldown expires",
  async (header) => {
    await using dir = await tmpdir()
    const now = Date.now()
    let calls = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        calls++
        if (calls > 1) return Response.json({ tag_name: "recovered" })
        const headers =
          header === "seconds"
            ? { "retry-after": "600" }
            : header === "date"
              ? { "retry-after": new Date(now + 600_000).toUTCString() }
              : header === "reset"
                ? { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.ceil((now + 600_000) / 1000)) }
                : {}
        return new Response("rate limited", { status: header === "reset" ? 403 : 429, headers })
      },
    })
    try {
      await expect(request(dir.path, [`${server.url}first`])).rejects.toThrow()
      // Recreated service, different release, same API budget: no request before the deadline.
      setSystemTime(new Date(now + 299_000))
      await expect(request(dir.path, [`${server.url}second`])).rejects.toThrow()
      expect(calls).toBe(1)
      if (header !== "fallback") {
        setSystemTime(new Date(now + 599_000))
        await expect(request(dir.path, [`${server.url}third`])).rejects.toThrow()
        expect(calls).toBe(1)
      }
      setSystemTime(new Date(now + (header === "fallback" ? 301_000 : 601_000)))
      expect(await request(dir.path, [`${server.url}first`])).toEqual([{ tag_name: "recovered" }])
      expect(calls).toBe(2)
    } finally {
      setSystemTime()
      await server.stop(true)
    }
  },
)

test("failed release lookups pause retries across reloads without blocking unrelated releases", async () => {
  await using dir = await tmpdir()
  const now = Date.now()
  let calls = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      calls++
      return new URL(req.url).pathname === "/broken"
        ? new Response("unavailable", { status: 503 })
        : Response.json({ tag_name: "ok" })
    },
  })
  try {
    await expect(request(dir.path, [`${server.url}broken`])).rejects.toThrow()
    await expect(request(dir.path, [`${server.url}broken`])).rejects.toThrow()
    expect(calls).toBe(1)
    expect(await request(dir.path, [`${server.url}other`])).toEqual([{ tag_name: "ok" }])
    expect(calls).toBe(2)
    setSystemTime(new Date(now + 301_000))
    await expect(request(dir.path, [`${server.url}broken`])).rejects.toThrow()
    expect(calls).toBe(3)
  } finally {
    setSystemTime()
    await server.stop(true)
  }
})
