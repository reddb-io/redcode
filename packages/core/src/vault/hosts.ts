export * as VaultHosts from "./hosts.js"

import path from "path"
import { Effect } from "effect"
import type { Tool } from "@opencode/schema/tool"
import { Permission } from "../permission.js"
import { Vault } from "./vault.js"

/**
 * Host binding: a secret goes to a destination only after the user allowed that pair once, or always, which the
 * vault remembers on the secret. A destination is a host such as `api.github.com`, `cmd:<program>` for a local
 * command that receives the value, `mcp:<server>` or `file:<path>`. When a command's destination cannot be told,
 * the user decides with the whole command in front of them and "always" is not offered. Every prompt covers all
 * pairs a call still needs, so a new secret and host pair costs at most one prompt.
 */

export const ACTION = "vault"

/** Where a call sends what it carries: the destinations it names, or none that can be told apart. */
export type Destinations = { readonly known: ReadonlyArray<string> } | { readonly unknown: true }

/**
 * Programs that reach the network by themselves. A segment that mentions one anywhere, as a wrapper's argument
 * too, and names no destination is asked about as unknown.
 */
const NETWORK = new Set([
  "curl",
  "wget",
  "http",
  "https",
  "xh",
  "httpie",
  "git",
  "gh",
  "ssh",
  "scp",
  "sftp",
  "rsync",
  "nc",
  "ncat",
  "netcat",
  "socat",
  "telnet",
  "ftp",
  "openssl",
])
/** Programs that run the next word as the command. */
const WRAPPERS = new Set(["sudo", "env", "time", "exec", "command", "nohup", "nice", "builtin"])
const LINK = /[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s'"`<>|;&()]{1,4096}/g
const REFERENCE = /\{vault:[a-z0-9-]{1,64}\}/g
const REMOTE = /^(?:[A-Za-z0-9._+-]{1,128}@)?([A-Za-z0-9][A-Za-z0-9.-]{0,252}):(?!\/\/)/
const LOGIN = /^[A-Za-z0-9._+-]{1,128}@([A-Za-z0-9][A-Za-z0-9.-]{0,252})$/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]{0,127}=/
const UNKNOWN = ""

/**
 * The destinations of a shell command from its simple commands, as the permission scan splits them. A segment
 * that names URLs or remotes goes to their hosts; a network program without one makes the whole command unknown;
 * any other segment that carries a reference goes to its program, `cmd:<program>`.
 */
export function shell(segments: ReadonlyArray<string>): Destinations {
  const found = segments.map(segment)
  if (found.some((item) => item === undefined)) return { unknown: true }
  return { known: Array.from(new Set(found.flatMap((item) => item ?? []))) }
}

/** Whether a destination is a network host, not a local command, an MCP server or a file. */
export const isHost = (destination: string) => !/^(?:cmd|mcp|file):/.test(destination)

/** The host of a URL that carries references, or unknown when a reference or variable names the host itself. */
export function url(text: string): Destinations {
  const host = hostOf(text)
  return host === UNKNOWN ? { unknown: true } : { known: [host] }
}

/** The pairs of `names` and destinations the user has not allowed yet, given where each name may already go. */
export const pending = (
  names: ReadonlyArray<string>,
  destinations: ReadonlyArray<string>,
  allowed: ReadonlyMap<string, ReadonlyArray<string>>,
) =>
  names.flatMap((name) =>
    destinations
      .filter((destination) => !(allowed.get(name) ?? []).includes(destination))
      .map((destination) => ({ name, destination })),
  )

/**
 * Asks the user to let `names` go to `destinations` unless every pair is allowed already, and remembers an
 * "always" on each secret. Outside a Session's tool execution nothing resolves, so there is nothing to ask.
 */
export const approve = Effect.fn("VaultHosts.approve")(function* (input: {
  readonly permission: Permission.Interface
  readonly context: Tool.Context
  readonly names: ReadonlyArray<string>
  readonly destinations: Destinations
  /** What the prompt shows besides the pairs, with references as names: the command, the URL or the file. */
  readonly detail: { readonly command?: string; readonly url?: string; readonly file?: string }
}) {
  const binding = yield* Vault.Current
  if (!binding || input.names.length === 0) return
  const ask = {
    action: ACTION,
    sessionID: input.context.sessionID,
    agent: input.context.agent,
    source: { type: "tool" as const, messageID: input.context.messageID, id: input.context.id },
    // A broad allow rule must not send a secret anywhere: only the pairs the user allowed skip the prompt.
    force: true,
  }
  if ("unknown" in input.destinations) {
    yield* input.permission.assert({
      ...ask,
      resources: input.names.map((name) => `${name}@unknown`),
      save: [],
      metadata: { secrets: input.names, destinations: ["an unknown destination"], ...input.detail },
    })
    return
  }
  const pairs = pending(input.names, input.destinations.known, yield* binding.hosts(input.names))
  if (pairs.length === 0) return
  const resources = pairs.map((pair) => `${pair.name}@${pair.destination}`)
  const decision = yield* input.permission.decide(
    {
      ...ask,
      resources,
      save: resources,
      metadata: {
        secrets: Array.from(new Set(pairs.map((pair) => pair.name))),
        destinations: Array.from(new Set(pairs.map((pair) => pair.destination))),
        ...input.detail,
      },
    },
    { persist: false },
  )
  if (decision === "always")
    yield* Effect.forEach(pairs, (pair) => binding.allow(pair.name, pair.destination), { discard: true })
})

function segment(text: string): ReadonlyArray<string> | undefined {
  const words = text.trim().split(/\s+/).map(unquote)
  const program = programOf(words)
  const hosts = [
    ...Array.from(text.matchAll(LINK), (match) => hostOf(match[0])),
    ...(program === "git" || program === "scp" || program === "rsync" || program === "sftp" || program === "ssh"
      ? words.flatMap((word) => remoteOf(word, program))
      : []),
  ]
  if (hosts.includes(UNKNOWN)) return undefined
  if (hosts.length > 0) return hosts
  if (words.some((word) => NETWORK.has(path.basename(word).toLowerCase()))) return undefined
  return Vault.references(text).length > 0 ? [`cmd:${program || "shell"}`] : []
}

function programOf(words: ReadonlyArray<string>): string {
  const word = words.find((item) => !ASSIGNMENT.test(item) && !WRAPPERS.has(path.basename(item)))
  return word === undefined ? "" : path.basename(word).toLowerCase()
}

function remoteOf(word: string, program: string) {
  const remote = REMOTE.exec(word)?.[1]
  if (remote !== undefined) return [remote.toLowerCase()]
  const login = program === "ssh" || program === "sftp" ? LOGIN.exec(word)?.[1] : undefined
  return login === undefined ? [] : [login.toLowerCase()]
}

/** The host a URL names, or `UNKNOWN` when a reference or variable names it or it does not parse. */
function hostOf(text: string) {
  const authority = text.slice(text.indexOf("://") + 3).split(/[/?#]/, 1)[0] ?? ""
  const host = authority.slice(authority.lastIndexOf("@") + 1)
  // References elsewhere, such as in the user part or the query, only need to parse.
  const parsable = text.replace(REFERENCE, "x")
  if (host === "" || /[{}$`%]/.test(host) || !URL.canParse(parsable)) return UNKNOWN
  return new URL(parsable).hostname.toLowerCase()
}

function unquote(word: string) {
  return word.replace(/^['"]{1,8}/, "").replace(/['"]{1,8}$/, "")
}
