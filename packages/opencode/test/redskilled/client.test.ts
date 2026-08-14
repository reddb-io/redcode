import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { createServer, type Server } from "node:net"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { decode, encode, type JsonValue } from "@reddb-io/toon"
import { readPayload, readStatusline } from "../../src/redskilled/client"

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("native redskilled client", () => {
  test("reads one TOON statusline payload without starting a daemon", async () => {
    const socket = await socketPath()
    const server = createServer((connection) => {
      let buffer = ""
      connection.on("data", (chunk) => {
        buffer += chunk.toString("utf8")
        const end = buffer.indexOf("\n\n")
        if (end < 0) return
        const request = decode(buffer.slice(0, end + 1)) as Record<string, unknown>
        expect(request.op).toBe("statusline-payload")
        expect(request.session_project).toBe("acme/widgets")
        connection.end(`${encode({ id: request.id, ok: true, value: { version: 1, workers: 2 } } as JsonValue)}\n\n`)
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => server.listen(socket, resolve).once("error", reject))

    await expect(readPayload("acme/widgets", 500, socket)).resolves.toEqual({ version: 1, workers: 2 })
  })

  test("fails within the requested deadline when the socket stays silent", async () => {
    const socket = await socketPath()
    const server = createServer()
    servers.push(server)
    await new Promise<void>((resolve, reject) => server.listen(socket, resolve).once("error", reject))
    const started = Date.now()

    await expect(readPayload(undefined, 30, socket)).rejects.toThrow("timed out")
    expect(Date.now() - started).toBeLessThan(250)
  })

  test("reads the daemon-owned RedSkills statusline render", async () => {
    const socket = await socketPath()
    const server = createServer((connection) => {
      let buffer = ""
      connection.on("data", (chunk) => {
        buffer += chunk.toString("utf8")
        const end = buffer.indexOf("\n\n")
        if (end < 0) return
        const request = decode(buffer.slice(0, end + 1)) as Record<string, unknown>
        expect(request.op).toBe("statusline-string")
        expect(request.render).toMatchObject({ mode: "local", project: "acme/widgets", verbose: false })
        connection.end(
          `${encode({
            id: request.id,
            ok: true,
            value: {
              line: "2 Workers · acme/widgets",
              degraded: false,
              stale: false,
              generated_at: "2026-08-14T12:00:00.000Z",
            },
          } as JsonValue)}\n\n`,
        )
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => server.listen(socket, resolve).once("error", reject))

    await expect(readStatusline("acme/widgets", false, 500, socket)).resolves.toEqual({
      line: "2 Workers · acme/widgets",
      degraded: false,
      stale: false,
      generated_at: "2026-08-14T12:00:00.000Z",
    })
  })
})

async function socketPath() {
  const root = path.join("/tmp", `red-code-redskilled-${randomUUID()}`)
  roots.push(root)
  await mkdir(root, { recursive: true })
  return path.join(root, "redskilled.sock")
}
