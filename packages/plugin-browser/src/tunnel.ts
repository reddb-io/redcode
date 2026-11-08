export * as BrowserTunnel from "./tunnel.js"

import { lookup } from "node:dns/promises"
import { isIP, type Socket } from "node:net"
import { Effect, Exit } from "effect"
import { Browser } from "./rpc.js"
import { BrowserTunnelMachine } from "./tunnel-machine.js"

export type Tunnels = ReturnType<typeof make>
export type Policy = { allowPrivateTarget?: (host: string, port: number) => boolean }

// One instance belongs to one desktop attachment. Socket buffers provide
// backpressure; reads never collect an unbounded stream in application memory.
export function make(policy: Policy = {}) {
  let state = BrowserTunnelMachine.initial()
  const sockets = new Map<string, Socket>()
  const dispatch = (event: BrowserTunnelMachine.Event) => {
    const next = BrowserTunnelMachine.transition(state, event)
    state = next.state
    next.effects.forEach((effect) => {
      sockets.get(effect.id)?.destroy()
      sockets.delete(effect.id)
    })
  }

  return {
    open: Effect.fn("BrowserTunnel.open")(function* (target: Browser.TunnelTarget) {
      const rejected = BrowserTunnelMachine.openError(state)
      if (rejected) return yield* Effect.fail(rejected)
      const id = crypto.randomUUID()
      dispatch({ type: "open.started", id })
      return yield* Effect.gen(function* () {
        const resolved = yield* resolveTarget(target, policy)
        const { createConnection } = yield* Effect.promise(() => import("node:net"))
        const socket = yield* Effect.try({
          try: () =>
            createConnection({
              host: resolved.address,
              port: target.port,
              family: resolved.family,
              allowHalfOpen: true,
            }),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        })
        sockets.set(id, socket)
        socket.on("error", (error) => dispatch({ type: "socket.errored", id, error }))
        socket.once("close", () => dispatch({ type: "socket.closed", id }))
        yield* Effect.callback<void, Error>((resume) => {
          const connected = () => {
            cleanup()
            socket.setNoDelay(true)
            resume(Effect.void)
          }
          const failed = (error: Error) => {
            cleanup()
            resume(Effect.fail(error))
          }
          const closed = () => failed(new Error("Browser tunnel closed while connecting."))
          const cleanup = () => {
            socket.off("connect", connected)
            socket.off("error", failed)
            socket.off("close", closed)
          }
          socket.once("connect", connected)
          socket.once("error", failed)
          socket.once("close", closed)
          if (socket.destroyed) closed()
          if (!socket.destroyed && !socket.connecting) connected()
          return Effect.sync(cleanup)
        }).pipe(
          Effect.timeoutOrElse({
            duration: "10 seconds",
            orElse: () => Effect.fail(new Error("Browser tunnel target connection timed out.")),
          }),
        )
        dispatch({ type: "open.connected", id })
        if (!BrowserTunnelMachine.isOpen(state, id))
          return yield* Effect.fail(new Error("Browser attachment is closed."))
        return id
      }).pipe(Effect.onError(() => Effect.sync(() => dispatch({ type: "open.failed", id }))))
    }),
    read: Effect.fn("BrowserTunnel.read")(function* (id: string) {
      const socket = sockets.get(id)
      const rejected = BrowserTunnelMachine.readError(state, id)
      if (rejected || !socket) return yield* Effect.fail(rejected ?? new Error("Browser tunnel is closed or unknown."))
      dispatch({ type: "read.started", id })
      let outcome: BrowserTunnelMachine.ReadOutcome = "interrupted"
      return yield* Effect.callback<Browser.TunnelRead, Error>((resume) => {
        const done = (value: Effect.Effect<Browser.TunnelRead, Error>, result: BrowserTunnelMachine.ReadOutcome) => {
          cleanup()
          outcome = result
          resume(value)
        }
        const pull = () => {
          const error = BrowserTunnelMachine.socketError(state, id)
          if (error) return done(Effect.fail(error), "error")
          const size = Math.min(socket.readableLength, Browser.TUNNEL_CHUNK_BYTES)
          if (size > 0) {
            const data: Buffer = socket.read(size)
            return done(Effect.succeed({ data, eof: false }), "chunk")
          }
          if (socket.readableEnded || socket.destroyed)
            done(Effect.succeed({ data: new Uint8Array(), eof: true }), "eof")
        }
        const cleanup = () => {
          socket.off("readable", pull)
          socket.off("end", pull)
          socket.off("error", pull)
          socket.off("close", pull)
        }
        socket.on("readable", pull)
        socket.on("end", pull)
        socket.on("error", pull)
        socket.on("close", pull)
        pull()
        return Effect.sync(cleanup)
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => dispatch({ type: "read.settled", id, outcome, socketClosed: socket.destroyed })),
        ),
      )
    }),
    write: Effect.fn("BrowserTunnel.write")(function* (id: string, data: Uint8Array, end: boolean = false) {
      const socket = sockets.get(id)
      const rejected = BrowserTunnelMachine.writeError(state, id)
      if (rejected || !socket || socket.destroyed || socket.writableEnded)
        return yield* Effect.fail(rejected ?? new Error("Browser tunnel is not writable."))
      dispatch({ type: "write.started", id })
      yield* Effect.callback<void, Error>((resume) => {
        const done = (error?: Error | null) => {
          cleanup()
          resume(error ? Effect.fail(error) : Effect.void)
        }
        const failed = (error: Error) => done(error)
        const closed = () =>
          done(BrowserTunnelMachine.socketError(state, id) ?? new Error("Browser tunnel closed while writing."))
        const cleanup = () => {
          socket.off("error", failed)
          socket.off("close", closed)
        }
        socket.once("error", failed)
        socket.once("close", closed)
        if (end) socket.end(data, done)
        if (!end) socket.write(data, done)
        return Effect.sync(cleanup)
      }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() =>
            dispatch({
              type: "write.settled",
              id,
              end,
              outcome: Exit.isSuccess(exit) ? "ok" : Exit.hasInterrupts(exit) ? "interrupted" : "error",
              socketClosed: socket.destroyed,
            }),
          ),
        ),
      )
    }),
    close: (id: string) => Effect.sync(() => dispatch({ type: "tunnel.closed", id })),
    dispose() {
      dispatch({ type: "disposed" })
    },
  }
}

export const privateResources = Effect.fn("BrowserTunnel.privateResources")(function* (resources: readonly string[]) {
  const inspected = yield* Effect.forEach(
    resources,
    (resource) =>
      Effect.tryPromise({
        try: async () => {
          const url = new URL(resource)
          if (url.protocol !== "http:" && url.protocol !== "https:") return false
          const addresses = await resolveHost(normalizeHost(url.hostname))
          return addresses.length > 0 && addresses.some((entry) => !publicAddress(entry.address))
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(Effect.catch(() => Effect.succeed(false))),
    { concurrency: 4 },
  )
  return resources.filter((_, index) => inspected[index])
})

export function resourceTarget(resource: string) {
  try {
    const url = new URL(resource)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return {
      host: normalizeHost(url.hostname),
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    }
  } catch {
    return undefined
  }
}

export function targetKey(host: string, port: number) {
  return `${normalizeHost(host)}:${port}`
}

export function publicAddress(address: string) {
  if (isIP(address) === 6) {
    const normalized = new URL(`http://[${address}]`).hostname.slice(1, -1)
    return (
      /^[23][0-9a-f]{3}:/i.test(normalized) && !/^2001:(db8:|0:|:)/i.test(normalized) && !/^2002:/i.test(normalized)
    )
  }
  if (isIP(address) !== 4) return false
  const [a, b, c] = address.split(".").map(Number)
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  )
}

const resolveTarget = Effect.fn("BrowserTunnel.resolveTarget")(function* (
  target: Browser.TunnelTarget,
  policy: Policy,
) {
  const host = normalizeHost(target.host)
  const addresses = yield* Effect.tryPromise({
    try: () => resolveHost(host),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
  if (!addresses.length) return yield* Effect.fail(new Error(`Browser tunnel could not resolve ${host}.`))
  const containsPrivate = addresses.some((entry) => !publicAddress(entry.address))
  if (containsPrivate && !policy.allowPrivateTarget?.(host, target.port))
    return yield* Effect.fail(
      new Error(
        `[browser.network.private] ${host}:${target.port} resolves to a private, loopback, link-local, metadata, or reserved address. Approve private-network access for this exact browser target before retrying.`,
      ),
    )
  // Pin the validated answer so a second DNS lookup cannot redirect the socket.
  return addresses.find((entry) => entry.family === 4) ?? addresses[0]!
})

function normalizeHost(host: string) {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
}
function resolveHost(host: string) {
  const family = isIP(host)
  return family ? Promise.resolve([{ address: host, family }]) : lookup(host, { all: true, verbatim: true })
}
