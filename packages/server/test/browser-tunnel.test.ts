import { expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BrowserTunnelHost } from "@opencode/plugin-browser/tunnel-host"
import { BrowserTunnelSocket } from "@opencode/plugin-browser/websocket"
import { StreamMux } from "@opencode/plugin-browser/stream-mux"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

it.live(
  "authenticates binary upgrades from the owning browser attachment and revokes replaced tickets",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "redcode-tunnel-test-"))),
        (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
      )
      const server = yield* ServerProcess.start({
        hostname: "127.0.0.1",
        port: 0,
        password: "fixture",
        database: { path: ":memory:" },
        config: { directory: root, global: false, project: false },
        models: { fetch: false },
        fs: { filewatcher: false, fff: false },
      })
      const base = HttpServer.formatAddress(server.address)
      const location = new URLSearchParams({ "location[directory]": root })
      const life = new AbortController()
      yield* Effect.addFinalizer(() => Effect.sync(() => life.abort()))
      yield* Effect.promise(async () => {
        const headers = { authorization: `Basic ${btoa("opencode:fixture")}`, "content-type": "application/json" }
        const created = await fetch(new URL("/api/session", base), {
          method: "POST",
          headers,
          body: JSON.stringify({ location: { directory: root }, title: "Browser tunnel fixture" }),
          signal: life.signal,
        })
        expect(created.status).toBe(200)
        const {
          data: { id: sessionID },
        } = await created.json()
        const response = await fetch(new URL("/api/event", base), { headers, signal: life.signal })
        const events = response.body!.getReader()
        const decoder = new TextDecoder()
        let pending = ""
        const nextEvent = async (predicate: (value: { type?: string; connectionID?: string }) => boolean) => {
          for (;;) {
            const boundary = pending.indexOf("\n\n")
            if (boundary < 0) {
              const next = await events.read()
              if (next.done) throw new Error("Event stream closed before attachment")
              pending += decoder.decode(next.value, { stream: true })
              continue
            }
            const frame = pending.slice(0, boundary)
            pending = pending.slice(boundary + 2)
            const line = frame.split("\n").find((line) => line.startsWith("data: "))
            if (!line) continue
            const event = JSON.parse(line.slice(6))
            if (predicate({ type: event.type, ...event.data })) return event.data
          }
        }
        await nextEvent((event) => event.type === "server.connected")
        const rpc = (method: string, input: object) =>
          fetch(new URL(`/api/rpc/experimental.browser/${method}?${location}`, base), {
            method: "POST",
            headers,
            body: JSON.stringify({ input }),
            signal: life.signal,
          })
        const attach = (connectionID: string) => rpc("attach", { sessionID, connectionID, version: 4 })
        const first = attach("first")
        void first.catch(() => {})
        const ready = await nextEvent((event) => event.type === "attached" && event.connectionID === "first")
        expect(ready.capabilities).toContain(BrowserTunnelHost.STREAM_CAPABILITY)
        const getTicket = async (connectionID = "first") => {
          const result = await rpc("tunnel.ticket", { sessionID, connectionID })
          expect(result.status).toBe(200)
          return (await result.json()).output.ticket as string
        }
        const url = new URL(`${BrowserTunnelHost.BROWSER_TUNNEL_PATH}?${location}`, base)
        url.protocol = "ws:"
        const open = (ticket: string, connectionID = "first", extra: Record<string, string> = {}) =>
          BrowserTunnelSocket.open(
            url,
            {
              [BrowserTunnelHost.TICKET_HEADER]: ticket,
              [BrowserTunnelHost.SESSION_HEADER]: sessionID,
              [BrowserTunnelHost.CONNECTION_HEADER]: connectionID,
              ...extra,
            },
            life.signal,
          )

        const ticket = await getTicket()
        await expect(open(ticket, "other")).rejects.toMatchObject({ fallback: false })
        await expect(open(ticket, "first", { origin: "https://untrusted.invalid" })).rejects.toMatchObject({
          fallback: false,
        })
        const mux = StreamMux.createClientMux(await open(ticket))
        try {
          await expect(open(ticket)).rejects.toMatchObject({ fallback: false })
          // Both transports still require an explicit grant for a private target.
          await expect(mux.openStream({ host: "127.0.0.1", port: 80 }, life.signal)).rejects.toThrow(
            "[browser.network.private]",
          )
          const legacy = await rpc("tunnel.open", {
            sessionID,
            connectionID: "first",
            target: { host: "127.0.0.1", port: 80 },
          })
          expect((await legacy.json()).message).toContain("[browser.network.private]")
          const pending = await getTicket()
          const second = attach("second")
          void second.catch(() => {})
          await nextEvent((event) => event.type === "attached" && event.connectionID === "second")
          expect(await (await first).json()).toEqual({ output: "replaced" })
          expect(await mux.closed).toMatchObject({ replaced: true })
          await expect(open(pending)).rejects.toMatchObject({ fallback: false })
          const replacement = StreamMux.createClientMux(await open(await getTicket("second"), "second"))
          replacement.close()
        } finally {
          mux.close()
          life.abort()
        }
      })
    }),
  20_000,
)
