import { Context, Layer } from "effect"
import { networkInterfaces } from "node:os"
import type { ServerOptions } from "./options"

export class Service extends Context.Service<
  Service,
  {
    readonly urls: () => ReadonlyArray<string>
    readonly app: NonNullable<ServerOptions["app"]>
    readonly paths: { readonly tmp: string }
    /** The database this server was started with, as its options gave it. */
    readonly database: { readonly path?: string; readonly url?: string } | undefined
    /** When the server started, in epoch milliseconds. */
    readonly started: number
  }
>()("@opencode/server/ServerInfo") {}

export function layer(
  urls: () => ReadonlyArray<string>,
  tmp: string,
  app: ServerOptions["app"] = {},
  database?: ServerOptions["database"],
) {
  return Layer.succeed(
    Service,
    Service.of({
      urls,
      app,
      paths: { tmp },
      database: database && { path: database.path, url: database.url },
      started: Date.now(),
    }),
  )
}

export function connectionURLs(value: string, requestedHostname?: string) {
  const url = new URL(value)
  const hostname = requestedHostname ?? url.hostname
  const family = hostname === "0.0.0.0" ? "IPv4" : hostname === "::" || hostname === "[::]" ? "IPv6" : undefined
  if (family === undefined) return [value]

  return [
    ...new Set(
      Object.values(networkInterfaces())
        .flatMap((entries) => entries ?? [])
        .filter((entry) => !entry.internal && entry.family === family)
        .map((entry) => {
          const result = new URL(value)
          result.hostname = family === "IPv6" ? `[${entry.address}]` : entry.address
          return result.toString().replace(/\/$/, "")
        }),
    ),
  ]
}

export * as ServerInfo from "./server-info"
