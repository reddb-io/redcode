export * as RemoteAccessController from "./remote-access"

import { Deferred, Effect, Fiber, FileSystem, Schema, Scope } from "effect"
import { Global } from "@opencode/util/global"
import { RemoteAccess } from "@opencode/schema/remote-access"
import type { RemoteAccessHost } from "@opencode/server/remote-access"
import { createHash, randomBytes } from "node:crypto"
import path from "node:path"
import { RemoteTunnel } from "./remote-tunnel"
import { ServiceConfig } from "./service-config"

type Connection = { relay: string; route: string; url?: string; fiber?: Fiber.Fiber<void, never> }

/** Owns only this listener's tunnel. Provisioning outlives an HTTP request, but not its host process. */
export const make = Effect.fnUntraced(function* (managed: boolean) {
  const scope = yield* Scope.Scope
  const global = yield* Global.Service
  const fs = yield* FileSystem.FileSystem
  const run = Effect.runPromiseWith(yield* Effect.context<Global.Service | FileSystem.FileSystem>())
  let target = ""
  let file = ""
  let config: ServiceConfig.Info = {}
  let state: RemoteAccess.Status = { available: true, state: "disabled" }
  let active: Connection | undefined
  let busy = false
  let closed = false

  const save = (connection?: Connection) =>
    managed
      ? connection
        ? ServiceConfig.rememberRemote(connection.relay, connection.route)
        : ServiceConfig.disableRemote()
      : Effect.gen(function* () {
          yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 })
          yield* fs.writeFileString(
            file + ".tmp",
            JSON.stringify(
              connection
                ? {
                    relay: connection.relay,
                    remote: { route: connection.route },
                    remoteAccepted: true,
                  }
                : {},
            ),
            { mode: 0o600 },
          )
          yield* fs.rename(file + ".tmp", file)
        })

  const configure: RemoteAccessHost.Interface["configure"] = async (input) => {
    if (closed || !target) throw new Error("HTTPS setup is unavailable")
    if (input.acceptExposure !== true) throw new Error("Internet exposure must be accepted")
    const relay = RemoteTunnel.apiURL(input.relay)
    if (busy) {
      if (state.relay === relay) return { ...state }
      throw new Error("HTTPS setup is already in progress")
    }
    if (active?.relay === relay && state.state === "ready") return { ...state }
    busy = true
    const previous = active
    const candidate: Connection = {
      relay,
      route:
        config.remote && (config.relay ?? RemoteTunnel.HOSTED_API) === relay
          ? config.remote.route
          : randomBytes(8).toString("hex"),
    }
    state = { available: true, state: "provisioning", relay, url: previous?.url }
    await run(
      Effect.gen(function* () {
        yield* RemoteTunnel.ensure(relay)
        state = { ...state, state: "connecting" }
        const ready = yield* Deferred.make<void, Error>()
        const failed = () => {
          Effect.runSync(Deferred.fail(ready, new Error("HTTPS connection stopped")))
          if (active === candidate && !busy)
            state = { available: true, state: "failed", relay, detail: "HTTPS connection stopped. Retry setup." }
        }
        candidate.fiber = yield* Effect.forkIn(
          RemoteTunnel.run({
            route: candidate.route,
            target,
            api: relay,
            onURL: (url) => {
              candidate.url = url
              if (url) Effect.runSync(Deferred.succeed(ready, undefined))
              if (active === candidate && !busy)
                state = { available: true, state: url ? "ready" : "connecting", relay, url }
            },
            onError: failed,
          }).pipe(Effect.catch(() => Effect.sync(failed))),
          scope,
        )
        yield* Deferred.await(ready).pipe(Effect.timeout("90 seconds"))
        yield* Effect.gen(function* () {
          yield* save(candidate)
          config = { relay, remote: { route: candidate.route }, remoteAccepted: true }
          active = candidate
          state = { available: true, state: "ready", relay, url: candidate.url }
          if (previous?.fiber) yield* Fiber.interrupt(previous.fiber)
        }).pipe(Effect.uninterruptible)
      }).pipe(
        Effect.provideService(Global.Service, global),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.catchCause(() =>
          Effect.gen(function* () {
            if (candidate !== active && candidate.fiber) yield* Fiber.interrupt(candidate.fiber)
            if (!closed)
              state = {
                available: true,
                state: "failed",
                relay,
                url: previous?.url,
                detail: "Could not enable HTTPS. Check the relay address and connectivity, then retry.",
              }
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            busy = false
          }),
        ),
        (effect) => Effect.forkIn(effect, scope),
      ),
    )
    return { ...state }
  }

  const host: RemoteAccessHost.Interface = {
    status: () => ({ ...state }),
    configure,
    disable: async () => {
      if (closed || busy) throw new Error("Wait for HTTPS setup to finish")
      busy = true
      try {
        await run(save())
        const previous = active
        active = undefined
        config = {}
        if (previous?.fiber) await run(Fiber.interrupt(previous.fiber))
        state = { available: true, state: "disabled" }
        return { ...state }
      } finally {
        busy = false
      }
    },
  }
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true
    }),
  )
  return {
    host,
    urls: () => (active?.url ? [active.url] : []),
    bind: Effect.fnUntraced(function* (bound: string) {
      target = bound
      file = path.join(
        global.config,
        "remote-access",
        createHash("sha256").update(target).digest("hex").slice(0, 24) + ".json",
      )
      config = managed
        ? yield* ServiceConfig.read()
        : yield* fs.readFileString(file).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ServiceConfig.Info))),
            Effect.orElseSucceed(() => ({}) as ServiceConfig.Info),
          )
      const relay = config.relay ?? (config.remote ? RemoteTunnel.HOSTED_API : undefined)
      if (config.remote && relay)
        yield* Effect.tryPromise(() => configure({ relay, acceptExposure: true })).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              state = {
                available: true,
                state: "failed",
                detail: "Saved HTTPS settings need attention. Configure the relay again.",
              }
            }),
          ),
        )
    }),
  }
})
