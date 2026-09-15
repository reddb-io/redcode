import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { ModelsSnapshot } from "@reddb-io/redcode-core/models-snapshot"

const catalog = {
  acme: {
    id: "acme",
    name: "Acme",
    env: [],
    models: { "acme-1": { id: "acme-1", name: "Acme One" } },
  },
}

const routes = new Map<string, { status: number; body: string }>()
let server: ReturnType<typeof Bun.serve>
let base = ""
let dir = ""

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const route = routes.get(new URL(request.url).pathname)
      return route ? new Response(route.body, { status: route.status }) : new Response("unexpected", { status: 599 })
    },
  })
  base = `http://127.0.0.1:${server.port}`
  dir = await mkdtemp(path.join(os.tmpdir(), "redcode-models-snapshot-"))
})

afterAll(async () => {
  server.stop(true)
  await rm(dir, { recursive: true, force: true })
})

// Keeps the build loader off the internet: the public defaults are answered by the fake server.
const localFetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
    .replace("https://models.opencode.ai", `${base}/opencode`)
    .replace("https://models.dev", `${base}/modelsdev`)
  return fetch(url.startsWith(base) ? url : `${base}/unexpected`, init)
}) as typeof fetch

describe("ModelsSnapshot", () => {
  test("parseCatalog refuses block pages, error bodies and empty catalogs", () => {
    expect(ModelsSnapshot.parseCatalog(JSON.stringify(catalog))).toEqual(catalog)
    expect(ModelsSnapshot.parseCatalog("<html>Access denied</html>")).toBeUndefined()
    expect(ModelsSnapshot.parseCatalog(JSON.stringify({ error: "forbidden" }))).toBeUndefined()
    expect(ModelsSnapshot.parseCatalog("{}")).toBeUndefined()
    expect(ModelsSnapshot.parseCatalog("[]")).toBeUndefined()
  })

  test("sources normalizes base URLs, dedupes and appends the public endpoints", () => {
    expect(ModelsSnapshot.sources(["https://mirror.corp/", undefined, "https://models.opencode.ai"])).toEqual([
      "https://mirror.corp/api.json",
      "https://models.opencode.ai/api.json",
      "https://models.dev/api.json",
    ])
  })

  test("loadForBuild falls through a blocked source", async () => {
    routes.clear()
    routes.set("/opencode/api.json", { status: 403, body: "Forbidden" })
    routes.set("/modelsdev/api.json", { status: 200, body: JSON.stringify(catalog) })
    const text = await ModelsSnapshot.loadForBuild({ fetch: localFetch, attempts: 1, log: () => {} })
    expect(JSON.parse(text)).toEqual(catalog)
  })

  test("loadForBuild fails the build when no source yields a catalog", async () => {
    routes.clear()
    routes.set("/opencode/api.json", { status: 200, body: "<html>captive portal</html>" })
    routes.set("/modelsdev/api.json", { status: 403, body: "Forbidden" })
    await expect(ModelsSnapshot.loadForBuild({ fetch: localFetch, attempts: 1, log: () => {} })).rejects.toThrow(
      /Could not load a models catalog snapshot/,
    )
  })

  test("loadForBuild refuses a MODELS_DEV_API_JSON file that is not a catalog", async () => {
    const file = path.join(dir, "bad.json")
    await writeFile(file, "{}")
    await expect(ModelsSnapshot.loadForBuild({ file, log: () => {} })).rejects.toThrow(/not a models catalog/)
  })

  test("a bundle built with the loaded snapshot embeds a non-empty catalog", async () => {
    routes.clear()
    routes.set("/opencode/api.json", { status: 200, body: JSON.stringify(catalog) })
    const modelsData = await ModelsSnapshot.loadForBuild({ fetch: localFetch, attempts: 1, log: () => {} })
    const entry = path.join(dir, "entry.ts")
    await writeFile(
      entry,
      `declare const REDCODE_MODELS_DEV: Record<string, unknown> | undefined\nconsole.log(JSON.stringify(Object.keys(typeof REDCODE_MODELS_DEV === "undefined" ? {} : REDCODE_MODELS_DEV)))\n`,
    )
    // Same define the release builds pass (packages/redcode/script/build.ts, build-node.ts, packages/cli/script/build.ts).
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: path.join(dir, "out"),
      target: "bun",
      define: { REDCODE_MODELS_DEV: modelsData },
    })
    expect(result.success).toBe(true)
    const proc = Bun.spawnSync([process.execPath, result.outputs[0].path])
    expect(JSON.parse(proc.stdout.toString())).toEqual(["acme"])
  })
})
