import { afterEach, describe, expect, test } from "bun:test"
import { decode, encode } from "@reddb-io/toon"
import { Context } from "effect"
import { RpcMaxBodyBytes } from "@opencode-ai/protocol/rpc"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

function http(directory: string, path: string, init?: RequestInit) {
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        "x-opencode-directory": directory,
      },
    }),
    context,
  )
}

function request(directory: string, body: string, contentType: string) {
  return http(directory, "/rpc", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  })
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("JSON and TOON RPC", () => {
  test("answers JSON-RPC health requests", async () => {
    await using dir = await tmpdir()
    const response = await request(
      dir.path,
      JSON.stringify({ jsonrpc: "2.0", method: "health.get", params: {}, id: 1 }),
      "application/json",
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(await response.json()).toEqual({ jsonrpc: "2.0", result: { healthy: true }, id: 1 })
  })

  test("answers TOON-RPC health requests in TOON", async () => {
    await using dir = await tmpdir()
    const response = await request(
      dir.path,
      encode({ toonrpc: "1.0", method: "health.get", params: {}, id: 2 }),
      "application/toon",
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/toon")
    expect(decode(await response.text())).toEqual({ toonrpc: "1.0", result: { healthy: true }, id: 2 })
  })

  test("rejects non-empty params for no-parameter methods", async () => {
    await using dir = await tmpdir()
    const response = await request(
      dir.path,
      JSON.stringify({ jsonrpc: "2.0", method: "health.get", params: { ignored: true }, id: 3 }),
      "application/json",
    )

    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32602, message: "Invalid params" },
      id: 3,
    })
  })

  test("matches REST session reads and rejects invalid cursors", async () => {
    await using dir = await tmpdir()
    const created = await http(dir.path, "/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: dir.path } }),
    })
    expect(created.status).toBe(200)

    const restList = await http(dir.path, `/api/session?directory=${encodeURIComponent(dir.path)}`)
    const rpcList = await request(
      dir.path,
      JSON.stringify({ jsonrpc: "2.0", method: "session.list", params: { directory: dir.path }, id: 4 }),
      "application/json",
    )
    expect((await rpcList.json()).result).toEqual(await restList.json())

    const restActive = await http(dir.path, "/api/session/active")
    const rpcActive = await request(
      dir.path,
      JSON.stringify({ jsonrpc: "2.0", method: "session.active", params: {}, id: 5 }),
      "application/json",
    )
    expect((await rpcActive.json()).result).toEqual(await restActive.json())

    const invalid = await request(
      dir.path,
      JSON.stringify({ jsonrpc: "2.0", method: "session.list", params: { cursor: "invalid" }, id: 6 }),
      "application/json",
    )
    expect(await invalid.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32602, message: "Invalid params" },
      id: 6,
    })
  })

  test("does not answer notifications", async () => {
    await using dir = await tmpdir()
    const response = await request(
      dir.path,
      JSON.stringify({ jsonrpc: "2.0", method: "health.get", params: {} }),
      "application/json",
    )
    expect(response.status).toBe(204)
    expect(await response.text()).toBe("")
  })

  test("rejects batches", async () => {
    await using dir = await tmpdir()
    const response = await request(
      dir.path,
      JSON.stringify([{ jsonrpc: "2.0", method: "health.get", id: 4 }]),
      "application/json",
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Invalid Request: batches are not supported" },
      id: null,
    })
  })

  test("rejects unsupported content types", async () => {
    await using dir = await tmpdir()
    const response = await request(dir.path, "{}", "text/plain")
    expect(response.status).toBe(415)
  })

  test("rejects request bodies larger than 1 MiB", async () => {
    await using dir = await tmpdir()
    const response = await request(dir.path, " ".repeat(RpcMaxBodyBytes + 1), "application/json")
    expect(response.status).toBe(413)
  })
})
