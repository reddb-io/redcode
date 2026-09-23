/**
 * Which names this machine answers to, and how another device reaches it.
 *
 * The review surface serves model-written HTML and accepts feedback for a session, so it must not
 * answer a request whose Host is some other site's name: a page on that site could otherwise
 * resolve its own name to this machine and drive the surface from a browser. Only names that
 * really are this machine are accepted — loopback, the bound hostname, the interface addresses,
 * the machine's own name. The same list is what "open on another device" is built from.
 */

import os from "node:os"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "::", "[::]"])

/** Every address the machine's interfaces carry right now, plus its own name. */
export function ownNames(): Set<string> {
  const names = new Set<string>(LOOPBACK)
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list ?? []) {
        names.add(entry.address.toLowerCase())
        if (entry.family === "IPv6" || entry.address.includes(":")) names.add(`[${entry.address.toLowerCase()}]`)
      }
    }
  } catch {
    // No interfaces to read: loopback and the hostname still answer.
  }
  try {
    const host = os.hostname().toLowerCase()
    if (host) {
      names.add(host)
      names.add(`${host}.local`)
    }
  } catch {
    // Same.
  }
  return names
}

/** The host part of a Host header, lower-cased, brackets kept for IPv6, the port dropped. */
export function hostOf(header: string): string {
  const value = header.trim().toLowerCase()
  if (!value) return ""
  if (value.startsWith("[")) {
    const end = value.indexOf("]")
    return end === -1 ? value : value.slice(0, end + 1)
  }
  const colon = value.lastIndexOf(":")
  return colon === -1 ? value : value.slice(0, colon)
}

/** Is this Host one of ours? `extra` is the bound hostname and anything the person configured. */
export function allowed(header: string | undefined, extra: readonly string[] = []): boolean {
  if (header === undefined) return true
  const host = hostOf(header)
  if (!host) return false
  if (ownNames().has(host)) return true
  return extra.some((name) => name.trim().toLowerCase() === host)
}

/** A private (RFC 1918 / link-local) IPv4 is what a phone on the same network can reach. */
function reachable(address: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(address)
}

/**
 * The URL another device on the network would use, or nothing when the server only listens on
 * loopback. A wildcard bind is replaced by the first LAN address; a real hostname is kept.
 */
export function networkURL(server: URL | undefined): string | undefined {
  if (!server) return undefined
  const host = server.hostname.toLowerCase()
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return undefined
  if (host !== "0.0.0.0" && host !== "::" && host !== "[::]") return server.origin
  let lan: string | undefined
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list ?? []) {
        if (entry.internal || entry.family !== "IPv4") continue
        if (reachable(entry.address)) return `${server.protocol}//${entry.address}:${server.port}`
        lan ??= entry.address
      }
    }
  } catch {
    return undefined
  }
  return lan ? `${server.protocol}//${lan}:${server.port}` : undefined
}

export * as DesignHost from "./host"
