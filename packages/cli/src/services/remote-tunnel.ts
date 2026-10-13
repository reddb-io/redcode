export * as RemoteTunnel from "./remote-tunnel"

import type { OpenTunnelError } from "@opentunnel/client/effect"
import { Cause, Effect, Schedule } from "effect"
import { EOL } from "os"
import { Global } from "@opencode/util/global"
import { createHash } from "node:crypto"
import path from "node:path"

export const HOSTED_API = "https://opentunnel.xyz"

export function apiURL(value: string) {
  const url = URL.parse(value)
  const local = url && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (
    !url ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Relay must be an HTTPS origin without credentials, paths, query or fragment; HTTP is allowed only on loopback",
    )
  return url.origin
}

const connection = Effect.fn("cli.remote-tunnel.connection")(function* (selected?: string) {
  const { OpenTunnelStorage } = yield* Effect.promise(() => import("@opentunnel/client/effect"))
  const global = yield* Global.Service
  const api = apiURL(selected ?? HOSTED_API)
  const profile = `relay-${createHash("sha256").update(api).digest("hex").slice(0, 32)}`
  const storage = OpenTunnelStorage.xdg({
    home: global.home,
    env: { XDG_DATA_HOME: path.join(global.data, "connections") },
  })
  // Preserve old hosted links, without modifying the other CLI's global profile or copying its credentials to another relay.
  if (
    api === HOSTED_API &&
    (yield* storage.load(profile)) === undefined &&
    (yield* storage.loadPending(profile)) === undefined
  ) {
    const legacy = OpenTunnelStorage.xdg()
    const identity = yield* legacy.load("default")
    if (identity?.hostname.endsWith(".opentunnel.xyz")) yield* storage.save(profile, identity)
    else {
      const pending = yield* legacy.loadPending("default")
      if (pending?.hostname.endsWith(".opentunnel.xyz")) yield* storage.savePending(profile, pending)
    }
  }
  return { api, storage, profile }
})

// Each relay has a private Redcode profile. Routes use random subdomains; authentication still belongs to the server.

// Holds the route for the life of the service. The SDK reconnects through network failures itself, so only
// setup failures reach the retry here; a rejected token or failed certificate stops it for good.
export const run = Effect.fnUntraced(function* (input: {
  readonly route: string
  readonly target: string
  readonly onURL: (url: string | undefined) => void
  readonly api?: string
}) {
  const { OpenTunnelClient, OpenTunnelAttachError } = yield* Effect.promise(() => import("@opentunnel/client/effect"))
  const fatal = (error: OpenTunnelError) =>
    error._tag === "OpenTunnelClientError" &&
    (error.cause instanceof OpenTunnelAttachError || error.message.startsWith("Certificate issuance failed"))
  const options = yield* connection(input.api)
  yield* Effect.gen(function* () {
    const client = yield* OpenTunnelClient
    const connection = yield* client.tunnel.connect({
      profile: options.profile,
      routes: { [input.route]: input.target },
    })
    input.onURL(`https://${input.route}.${connection.tunnel.hostname}`)
    yield* connection.closed
  }).pipe(
    Effect.scoped,
    Effect.ensuring(Effect.sync(() => input.onURL(undefined))),
    Effect.tapError((error) =>
      fatal(error) ? Effect.void : Effect.logWarning("remote access tunnel unavailable; retrying", { cause: error }),
    ),
    Effect.retry({
      while: (error) => !fatal(error),
      schedule: Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("30 seconds")]),
    }),
    Effect.provide(OpenTunnelClient.layer(options)),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logError("remote access tunnel stopped; run `redcode service set remote true` to retry", { cause }),
    ),
  )
})

// A device without a tunnel creates its shared one here, in the foreground, because issuing the certificate
// takes a while; the service then only attaches its route on start. An interrupted issuance resumes next time.
export const ensure = Effect.fnUntraced(function* (api?: string) {
  const { OpenTunnelClient } = yield* Effect.promise(() => import("@opentunnel/client/effect"))
  const options = yield* connection(api)
  return yield* Effect.gen(function* () {
    const client = yield* OpenTunnelClient
    if ((yield* client.tunnel.get({ profile: options.profile })) === undefined)
      process.stderr.write("Setting up remote access; this can take a minute..." + EOL)
    return (yield* client.tunnel.ensure({ profile: options.profile })).hostname
  }).pipe(
    Effect.provide(OpenTunnelClient.layer(options)),
    Effect.timeoutOrElse({
      duration: "5 minutes",
      orElse: () =>
        Effect.fail(new Error("Timed out creating the remote access tunnel; run the command again to resume")),
    }),
  )
})

// The tunnel hostname is persisted once the certificate is ready, so this is undefined until then.
export const hostname = Effect.fnUntraced(function* (route: string, api?: string) {
  const options = yield* connection(api)
  const identity = yield* options.storage.load(options.profile)
  return identity === undefined ? undefined : `${route}.${identity.hostname}`
})
