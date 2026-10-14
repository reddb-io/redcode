import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { ServiceConfig } from "../src/services/service-config"

test("memory diagnostics read the registered server's heap without replacing its version", async () => {
  await using directory = await tmpdir("redcode-memory-cli-")
  const requests: string[] = []
  const processMemory = {
    heapUsed: 600_000_000,
    heapTotal: 700_000_000,
    external: 20_000_000,
    arrayBuffers: 10_000_000,
  }
  const activity = { cachedLocations: 17, activeExecutions: 0 }
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      requests.push(pathname)
      if (request.headers.get("authorization") !== `Basic ${btoa("opencode:memory-fixture-secret")}`)
        return new Response(null, { status: 401 })
      if (pathname === "/api/info") return Response.json({ version: "memory-fixture", pid: process.pid, urls: [] })
      if (pathname === "/api/system")
        return Response.json({
          version: "memory-fixture",
          runtime: "fixture-runtime",
          pid: process.pid,
          memory: 2_800_000_000,
          processMemory,
          activity,
        })
      return new Response(null, { status: 404 })
    },
  })
  const registration = path.join(directory.path, "state", "opencode", ServiceConfig.filename())
  const contents = JSON.stringify({
    id: "memory-fixture",
    version: "memory-fixture",
    pid: process.pid,
    url: server.url.toString(),
    password: "memory-fixture-secret",
  })
  try {
    await Bun.write(registration, contents)
    const result = await cli(directory.path)
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).service).toEqual({
      pid: process.pid,
      version: "memory-fixture",
      runtime: "fixture-runtime",
      rss: 2_800_000_000,
      ...processMemory,
      ...activity,
    })
    expect(result.stdout).not.toContain("memory-fixture-secret")
    expect(requests).toEqual(["/api/info", "/api/system"])
    expect(await Bun.file(registration).text()).toBe(contents)
  } finally {
    await server.stop(true)
  }
})

test("memory diagnostics do not start an absent managed service", async () => {
  await using directory = await tmpdir("redcode-memory-cli-offline-")
  const result = await cli(directory.path)
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout)).not.toHaveProperty("service")
  expect(await Bun.file(path.join(directory.path, "state", "opencode", ServiceConfig.filename())).exists()).toBe(false)
})

async function cli(root: string) {
  const child = Bun.spawn(
    [process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), "debug", "memory", "--json"],
    {
      cwd: path.join(import.meta.dir, ".."),
      env: {
        ...process.env,
        REDCODE_TEST_HOME: path.join(root, "home"),
        OPENCODE_DB: ":memory:",
        XDG_DATA_HOME: path.join(root, "data"),
        XDG_CONFIG_HOME: path.join(root, "config"),
        XDG_CACHE_HOME: path.join(root, "cache"),
        XDG_STATE_HOME: path.join(root, "state"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
