export * as BrowserTunnelGateway from "./browser-tunnel.js"

import { randomBytes } from "node:crypto"
import { BrowserTunnelHost } from "@opencode/plugin-browser/tunnel-host"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { LocationServiceMap } from "./location-service-map.js"

const TICKET_LIFETIME_MS = 30_000
const MAX_PENDING_TICKETS = 2_048

export class Service extends Context.Service<Service, ReturnType<typeof make>>()("@opencode/BrowserTunnelGateway") {}

export function isUpgrade(request: {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string | undefined>>
}) {
  return (
    request.method === "GET" &&
    request.url.split("?", 1)[0] === BrowserTunnelHost.BROWSER_TUNNEL_PATH &&
    request.headers.upgrade?.toLowerCase() === "websocket"
  )
}

export function hasUpgradeTicket(request: Parameters<typeof isUpgrade>[0]) {
  return isUpgrade(request) && !!request.headers[BrowserTunnelHost.TICKET_HEADER]
}

export function make(enabled = false) {
  const tickets = new Map<string, { binding: BrowserTunnelHost.TicketBinding; expires: number }>()
  const byAttachment = new Map<BrowserTunnelHost.TicketBinding["owner"], string>()
  const remove = (ticket: string) => {
    const entry = tickets.get(ticket)
    if (!entry) return
    tickets.delete(ticket)
    byAttachment.delete(entry.binding.owner)
  }
  const host: BrowserTunnelHost.Interface | undefined = enabled
    ? {
        issue: (binding) =>
          Effect.try({
            try: () => {
              const now = Date.now()
              for (const [ticket, entry] of tickets) if (entry.expires <= now) remove(ticket)
              const previous = byAttachment.get(binding.owner)
              if (previous) remove(previous)
              if (tickets.size >= MAX_PENDING_TICKETS) throw new Error("Too many pending browser tunnel tickets.")
              const ticket = randomBytes(32).toString("base64url")
              tickets.set(ticket, { binding, expires: now + TICKET_LIFETIME_MS })
              byAttachment.set(binding.owner, ticket)
              return { ticket }
            },
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          }),
        revoke: (owner) => {
          const ticket = byAttachment.get(owner)
          if (ticket) remove(ticket)
        },
      }
    : undefined
  return {
    host,
    take(input: { ticket: string; sessionID: string; connectionID: string; directory: string; workspaceID?: string }) {
      const entry = tickets.get(input.ticket)
      if (!entry) return
      if (entry.expires <= Date.now()) {
        remove(input.ticket)
        return
      }
      const binding = entry.binding
      const directory = LocationServiceMap.canonical(binding.location).directory
      if (
        binding.sessionID !== input.sessionID ||
        binding.connectionID !== input.connectionID ||
        directory !== input.directory ||
        binding.location.workspaceID !== input.workspaceID
      )
        return
      remove(input.ticket)
      return binding
    },
  }
}

export const configured = (enabled: boolean) => Layer.sync(Service, () => Service.of(make(enabled)))
export const node = makeGlobalNode({ service: Service, layer: configured(false), deps: [] })
