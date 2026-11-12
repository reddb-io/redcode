import { expect, test } from "bun:test"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

const directory = path.join(import.meta.dir, "..")
const location = { directory }

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

test("MCP CLI exposes runtime lifecycle controls and the reauth alias", async () => {
  const result = await cli(["mcp", "--help"])
  expect(result.exitCode).toBe(0)
  for (const command of ["connect", "enable", "disconnect", "disable", "reconnect", "restart", "reload", "reauth"])
    expect(result.stdout).toContain(command)
})

test("MCP controls act on the selected server and project, reconnect only the named server, and report auth failures", async () => {
  const operations: string[] = []
  let status: { status: "connected" | "disabled" | "needs_auth"; error?: string } = { status: "connected" }
  let needsAuth = false
  using server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info")
        return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: "/tmp/opencode" } })
      if (url.pathname === "/api/model/default") return Response.json({ location, data: null })
      if (url.pathname === "/api/mcp") return Response.json({ location, data: [{ name: "company", status }] })
      if (request.method === "POST" && url.pathname.startsWith("/api/experimental/mcp/")) {
        expect(url.searchParams.get("location[directory]")).toBe(directory)
        operations.push(url.pathname)
        status = url.pathname.endsWith("/disconnect")
          ? { status: "disabled" }
          : needsAuth
            ? { status: "needs_auth", error: "HTTP 401: expired OAuth credential" }
            : { status: "connected" }
        return new Response(null, { status: 204 })
      }
      return new Response("Not found", { status: 404 })
    },
  })
  for (const [command, args] of [
    ["disable", ["company"]],
    ["enable", ["company"]],
    ["reconnect", ["company"]],
    ["reload", []],
    ["restart", []],
  ] as const) {
    const result = await cli(["mcp", command, ...args, "--server", server.url.toString()])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
  }
  expect(operations).toEqual([
    "/api/experimental/mcp/company/disconnect",
    "/api/experimental/mcp/company/connect",
    "/api/experimental/mcp/company/disconnect",
    "/api/experimental/mcp/company/connect",
    "/api/experimental/mcp/reload",
    "/api/experimental/mcp/restart",
  ])
  const listed = await cli(["mcp", "list", "--server", server.url.toString()])
  expect(listed.exitCode).toBe(0)
  expect(listed.stdout).toContain("company")
  expect(listed.stdout).toContain("connected")
  needsAuth = true
  const failed = await cli(["mcp", "connect", "company", "--server", server.url.toString()])
  expect(failed.exitCode).toBe(1)
  expect(failed.stdout + failed.stderr).toContain("HTTP 401: expired OAuth credential")
  expect(failed.stdout + failed.stderr).toContain('redcode mcp auth "company"')
})
