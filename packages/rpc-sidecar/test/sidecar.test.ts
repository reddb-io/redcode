import { describe, expect, test } from "bun:test"
import { MaxBodyBytes, MaxHeaderBytes } from "../src/main"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const command = process.env.REDCODE_RPC_SIDECAR_COMMAND
  ? [process.env.REDCODE_RPC_SIDECAR_COMMAND]
  : ["bun", path.join(root, "src/cli.ts")]

function frame(body: string) {
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

function frames(value: Uint8Array) {
  const output: string[] = []
  let offset = 0
  while (offset < value.byteLength) {
    const boundary = Buffer.from(value).indexOf("\r\n\r\n", offset)
    if (boundary < 0) throw new Error("missing frame boundary")
    const header = new TextDecoder().decode(value.slice(offset, boundary))
    const length = parseInt(header.match(/^Content-Length: (\d+)$/i)?.[1] ?? "", 10)
    const start = boundary + 4
    output.push(new TextDecoder().decode(value.slice(start, start + length)))
    offset = start + length
  }
  return output
}

async function execute(url: string, input: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn(command, {
    cwd: root,
    env: { ...process.env, ...env, REDCODE_RPC_URL: url },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const write = proc.stdin.write(input)
  if (typeof write !== "number") await write
  proc.stdin.end()
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

function server(handler: (request: Request) => Response | Promise<Response>) {
  const instance = Bun.serve({ port: 0, fetch: handler })
  return {
    url: new URL("/rpc", instance.url).href,
    [Symbol.dispose]: () => instance.stop(true),
  }
}

describe(`RPC sidecar (${command[0].endsWith("cli.ts") ? "source" : "native"})`, () => {
  test("forwards JSON with explicit authorization", async () => {
    let received: { contentType: string | null; authorization: string | null; body: string } | undefined
    using endpoint = server(async (request) => {
      received = {
        contentType: request.headers.get("content-type"),
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      }
      return Response.json({ jsonrpc: "2.0", result: { healthy: true }, id: 1 })
    })
    const body = JSON.stringify({ jsonrpc: "2.0", method: "health.get", id: 1 })
    const result = await execute(endpoint.url, frame(body), { REDCODE_AUTHORIZATION: "Bearer test" })

    expect(result.exitCode).toBe(0)
    expect(received).toEqual({ contentType: "application/json", authorization: "Bearer test", body })
    expect(JSON.parse(frames(result.stdout)[0])).toEqual({ jsonrpc: "2.0", result: { healthy: true }, id: 1 })
  })

  test("forwards TOON with basic authorization", async () => {
    const received: { contentType: string | null; authorization: string | null } = {
      contentType: null,
      authorization: null,
    }
    using endpoint = server((request) => {
      received.contentType = request.headers.get("content-type")
      received.authorization = request.headers.get("authorization")
      return new Response('toonrpc: "1.0"\nresult: true\nid: 2', {
        headers: { "content-type": "application/toon" },
      })
    })
    const result = await execute(endpoint.url, frame('toonrpc: "1.0"\nmethod: health.get\nid: 2'), {
      REDCODE_AUTHORIZATION: "",
      REDCODE_SERVER_USERNAME: "alice",
      REDCODE_SERVER_PASSWORD: "secret",
    })

    expect(result.exitCode).toBe(0)
    expect(received.contentType).toBe("application/toon")
    expect(received.authorization).toBe(`Basic ${Buffer.from("alice:secret").toString("base64")}`)
    expect(frames(result.stdout)).toEqual(['toonrpc: "1.0"\nresult: true\nid: 2'])
  })

  test("processes frames sequentially and preserves order", async () => {
    let active = 0
    let maximum = 0
    using endpoint = server(async (request) => {
      active++
      maximum = Math.max(maximum, active)
      const requestBody = (await request.json()) as { id: number }
      await Bun.sleep(requestBody.id === 1 ? 20 : 0)
      active--
      return Response.json({ jsonrpc: "2.0", result: requestBody.id, id: requestBody.id })
    })
    const first = JSON.stringify({ jsonrpc: "2.0", method: "health.get", id: 1 })
    const second = JSON.stringify({ jsonrpc: "2.0", method: "health.get", id: 2 })
    const result = await execute(endpoint.url, frame(first) + frame(second))

    expect(result.exitCode).toBe(0)
    expect(maximum).toBe(1)
    expect(frames(result.stdout).map((body) => JSON.parse(body).id)).toEqual([1, 2])
  })

  test("does not emit a frame for notifications", async () => {
    using endpoint = server(() => new Response(null, { status: 204 }))
    const body = JSON.stringify({ jsonrpc: "2.0", method: "health.get" })
    const result = await execute(endpoint.url, frame(body))

    expect(result.exitCode).toBe(0)
    expect(result.stdout.byteLength).toBe(0)
  })

  test("rejects oversized headers and bodies", async () => {
    using endpoint = server(() => new Response("unexpected"))
    const header = await execute(endpoint.url, `X-Test: ${"a".repeat(MaxHeaderBytes)}\r\n`)
    const body = await execute(endpoint.url, `Content-Length: ${MaxBodyBytes + 1}\r\n\r\n`)

    expect(header.exitCode).toBe(1)
    expect(header.stderr).toContain("header exceeds 8 KiB")
    expect(body.exitCode).toBe(1)
    expect(body.stderr).toContain("body exceeds 1 MiB")
  })

  test("does not follow redirects", async () => {
    let redirected = false
    using endpoint = server((request) => {
      if (new URL(request.url).pathname === "/redirected") {
        redirected = true
        return new Response("unexpected")
      }
      return new Response(null, { status: 302, headers: { location: "/redirected" } })
    })
    const body = JSON.stringify({ jsonrpc: "2.0", method: "health.get", id: 1 })
    const result = await execute(endpoint.url, frame(body))

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("attempted redirect")
    expect(redirected).toBe(false)
  })

  test("requires an exact credential-free RPC URL", async () => {
    const result = await execute("http://user:pass@127.0.0.1/rpc?x=1", "")
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("must not contain credentials")
  })

  test("exits 143 on SIGTERM", async () => {
    const received = Promise.withResolvers<void>()
    using endpoint = server(() => {
      received.resolve()
      return new Promise<Response>(() => undefined)
    })
    const proc = Bun.spawn(command, {
      cwd: root,
      env: { ...process.env, REDCODE_RPC_URL: endpoint.url },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    })
    const body = JSON.stringify({ jsonrpc: "2.0", method: "health.get", id: 1 })
    proc.stdin.write(frame(body))
    await received.promise
    proc.kill("SIGTERM")
    expect(await proc.exited).toBe(143)
  })
})
