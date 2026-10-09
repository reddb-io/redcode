export * as DesignApp from "./app.js"

import path from "node:path"
import { closeSync, openSync } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import { Option, Schema } from "effect"
import { Design } from "@opencode/schema/design"
import { Global } from "@opencode/util/global"
import { Flock } from "@opencode/util/flock"
import { DesignAppBinary } from "./app-binary.js"
import type { Database } from "../database/database.js"

/**
 * The contract between redcode and the design app (`redcode-design`), the separate process that serves
 * Design's review surface and runs its builds, renders and exports. redcode starts it on demand,
 * finds it again through a registration file, and talks to it with a shared token; the app reaches the
 * conversation back through redcode's `design.host` routes.
 */

/** Bumped whenever routes or payloads between redcode and the design app change incompatibly. */
export const PROTOCOL = 4

/** Minutes without review tabs, requests or running jobs before the app exits on its own. */
export const IDLE_MINUTES = 10

export const Registration = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  pid: Schema.Int,
  version: Schema.String,
  protocol: Schema.Int,
  database: Schema.optional(Schema.String),
})
export type Registration = typeof Registration.Type

export const Health = Schema.Struct({
  healthy: Schema.Literal(true),
  protocol: Schema.Int,
  version: Schema.String,
  pid: Schema.Int,
  database: Schema.optional(Schema.String),
})
export type Health = typeof Health.Type

export function databaseFingerprint(database: Database.Options) {
  return createHash("sha256")
    .update(JSON.stringify([database.path ?? null, database.url ?? null, database.token ?? null]))
    .digest("hex")
}
const Failure = Schema.Struct({
  code: Schema.Literals(["not-found", "conflict", "invalid", "unavailable"]),
  message: Schema.String,
})

/** Headers redcode sends so the app knows which redcode serves a session's `design.host`. */
export const HOST_HEADER = "x-design-host"
export const HOST_AUTHORIZATION_HEADER = "x-design-host-authorization"
/** The cookie a review or presentation window carries once it opened with a ticket. */
export const COOKIE = "design_ticket"
/** A review link's ticket is short-lived; the cookie it is exchanged for lasts a working day. */
export const LINK_TTL = 10 * 60_000
export const COOKIE_TTL = 12 * 60 * 60_000

export function paths(state = Global.Path.state) {
  return {
    registration: path.join(state, "design.json"),
    token: path.join(state, "design.token"),
    log: path.join(state, "design-app.log"),
  }
}

/** The shared secret, created on first use; readable only by this user. */
export async function token(file = paths().token) {
  const existing = await Bun.file(file)
    .text()
    .catch(() => "")
  if (existing.trim()) return existing.trim()
  const generated = randomBytes(32).toString("base64url")
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, generated, { mode: 0o600 })
  await rename(temp, file)
  return generated
}

/** A signed, expiring grant to one session's review surface, for windows that cannot send headers. */
export function ticket(secret: string, sessionID: string, ttl = LINK_TTL, now = Date.now()) {
  const expires = now + ttl
  return `${expires}.${sign(secret, sessionID, expires)}`
}

export function verify(secret: string, sessionID: string, value: string | undefined, now = Date.now()) {
  if (!value) return false
  const [expires, signature] = value.split(".")
  const time = Number(expires)
  if (!signature || !Number.isSafeInteger(time) || time < now) return false
  const expected = Buffer.from(sign(secret, sessionID, time))
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function sign(secret: string, sessionID: string, expires: number) {
  return createHmac("sha256", secret).update(`design:${sessionID}:${expires}`).digest("base64url")
}

export async function registration(file = paths().registration) {
  const text = await Bun.file(file)
    .text()
    .catch(() => undefined)
  if (!text) return undefined
  return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(Registration))(text))
}

export async function register(info: Omit<Registration, "id" | "protocol">, file = paths().registration) {
  const value: Registration = {
    id: crypto.randomUUID(),
    protocol: PROTOCOL,
    ...info,
  }
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${value.id}.tmp`
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 })
  await rename(temp, file)
  return value
}

/** Removes the registration only while it is still the given one: a newer app keeps its own. */
export async function unregister(id: string, file = paths().registration) {
  if ((await registration(file))?.id !== id) return
  await rm(file, { force: true })
}

/** Whether a process with this pid exists; one owned by another user still counts. */
export function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

export async function health(url: string, secret: string) {
  const response = await fetch(new URL("/app/health", url), {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(2_000),
  }).catch(() => undefined)
  if (!response?.ok) return undefined
  return Option.getOrUndefined(Schema.decodeUnknownOption(Health)(await response.json().catch(() => undefined)))
}

export interface EnsureInput {
  /** redcode's server: where the app reaches `design.host` for the sessions it serves. */
  readonly host: string
  /** How to start the app; resolved only when none runs. Default: see DesignAppBinary.command. */
  readonly command?: readonly string[] | (() => Promise<readonly string[]>)
  readonly state?: string
  readonly idleMinutes?: number
  /** How long a new app has to register. */
  readonly timeout?: number
  readonly env?: Record<string, string | undefined>
  readonly database?: string
}

const launches = new Map<string, Promise<{ url: string; token: string }>>()

/**
 * The running design app, started when none answers. A registration counts only while its process
 * lives, it answers its health check with this token, and it speaks this protocol; an app of another
 * protocol is asked to stop and a new one takes over the registration. Callers in this process share
 * one launch, so a review link opened while the app starts waits on that start.
 */
export function ensure(input: EnsureInput) {
  const key = `${paths(input.state).registration}:${input.database ?? ""}`
  const pending = launches.get(key)
  if (pending) return pending
  const launch = start(input)
  launches.set(key, launch)
  // A failure stays for a moment, so a page waiting on this launch shows it instead of starting another.
  launch.then(
    () => launches.delete(key),
    () => setTimeout(() => launches.delete(key), 5_000).unref(),
  )
  return launch
}

async function start(input: EnsureInput) {
  const files = paths(input.state)
  const secret = await token(files.token)
  const current = await reusable(files.registration, secret, input.database)
  if (current) return { url: current.url, token: secret }
  return Flock.withLock(
    `design-app:${files.registration}`,
    async () => {
      // Another redcode may have started one while this one waited for the lock.
      const started = await reusable(files.registration, secret, input.database)
      if (started) return { url: started.url, token: secret }
      DesignAppBinary.report({ phase: "start", started: Date.now() })
      const launch =
        typeof input.command === "function" ? await input.command() : (input.command ?? DesignAppBinary.command())
      if (!launch.length) throw new Error("The design app is not available in this installation")
      const log = openSync(files.log, "a", 0o600)
      const child = spawn(
        launch[0],
        [
          ...launch.slice(1),
          "serve",
          "--register",
          "--host-url",
          input.host,
          "--token-file",
          files.token,
          "--state",
          path.dirname(files.registration),
          "--idle-minutes",
          String(input.idleMinutes ?? IDLE_MINUTES),
        ],
        { detached: true, stdio: ["ignore", log, log], env: { ...process.env, ...input.env } },
      )
      child.unref()
      closeSync(log)
      const deadline = Date.now() + (input.timeout ?? 30_000)
      while (Date.now() < deadline) {
        if (child.exitCode !== null)
          throw new Error(`The design app exited with code ${child.exitCode} before it registered; see ${files.log}`)
        const info = await registration(files.registration)
        const answer = info && info.pid === child.pid ? await health(info.url, secret) : undefined
        if (
          info &&
          answer?.protocol === PROTOCOL &&
          answer.database === info.database &&
          info.database === input.database
        )
          return { url: info.url, token: secret }
        await sleep(100)
      }
      child.kill("SIGTERM")
      throw new Error(`The design app did not register in time; see ${files.log}`)
    },
    { timeoutMs: (input.timeout ?? 30_000) + 5_000 },
  ).finally(() => DesignAppBinary.report())
}

async function reusable(file: string, secret: string, database?: string) {
  const info = await registration(file)
  if (!info || !alive(info.pid)) return undefined
  const answer = await health(info.url, secret)
  if (!answer || answer.pid !== info.pid) return undefined
  const minimum = DesignAppBinary.MINIMUM
  if (
    answer.protocol === PROTOCOL &&
    info.protocol === PROTOCOL &&
    answer.version === info.version &&
    answer.database === info.database &&
    (database === undefined || info.database === database) &&
    (!minimum || Bun.semver.order(answer.version, minimum) >= 0)
  )
    return info
  // A different protocol or database cannot serve this redcode process.
  await stop(info.url, secret)
  return undefined
}

/** Asks an app to exit. It confirms before it goes, so a pid that was reused is never signalled. */
export async function stop(url: string, secret: string) {
  await fetch(new URL("/app/shutdown", url), {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(2_000),
  }).catch(() => undefined)
}

/** The redcode server design.host routes are reached at, with the authorization it expects. */
export interface Host {
  readonly url: string
  readonly authorization?: string
}

/** A running design app and, when redcode serves the conversation, where the app reaches it. */
export interface Connection {
  readonly url: string
  readonly token: string
  readonly host?: Host
}

let served: Host | undefined

/** A server bound to every interface is reached on loopback. */
export function loopback(url: string | URL) {
  const parsed = new URL(url)
  if (parsed.hostname === "0.0.0.0" || parsed.hostname === "[::]" || parsed.hostname === "::")
    parsed.hostname = "127.0.0.1"
  return parsed.origin
}

/** Records this process's redcode server: an app started from here reaches `design.host` there. */
export function serve(host: Host) {
  served = host
}

/** Start or reconnect to the app that serves Design for this redcode process. */
export async function connect(input: {
  readonly host?: Host
  readonly state?: string
  readonly database?: Database.Options
}) {
  const host = input.host ?? served
  if (!host) throw new Error("The design app needs a redcode server for its session routes")
  const started = await ensure({
    host: host.url,
    database: input.database ? databaseFingerprint(input.database) : undefined,
    state: input.state,
    ...(input.database
      ? {
          env: {
            OPENCODE_DB: input.database.path,
            REDCODE_DATABASE_URL: input.database.url,
            REDCODE_DATABASE_TOKEN: input.database.token,
          },
        }
      : {}),
  })
  return { ...started, host } satisfies Connection
}

/** Return a healthy registered app without starting another process. */
export async function running(state?: string): Promise<Connection | undefined> {
  const files = paths(state)
  const secret = await token(files.token)
  const info = await reusable(files.registration, secret)
  return info ? { url: info.url, token: secret } : undefined
}

/** Attach the Session owner before handing a signed review URL to a browser. */
export async function link(connection: Connection, sessionID: string, route = "/review") {
  if (!connection.host) throw new Error("The design app has no server for this Session")
  const attached = await fetch(new URL(`/design/session/${encodeURIComponent(sessionID)}/attach`, connection.url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${connection.token}`,
      [HOST_HEADER]: connection.host.url,
      ...(connection.host.authorization ? { [HOST_AUTHORIZATION_HEADER]: connection.host.authorization } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!attached.ok) throw new Error(`The design app did not attach the Session (${attached.status})`)
  const url = new URL(`/design/session/${encodeURIComponent(sessionID)}${route}`, connection.url)
  url.searchParams.set("ticket", ticket(connection.token, sessionID))
  return url.toString()
}

/** The public review stays on the owning Redcode server, including when rendering uses the app. */
export async function review(connection: Connection, sessionID: string) {
  await link(connection, sessionID)
  const response = await fetch(new URL(`/design/session/${encodeURIComponent(sessionID)}/link`, connection.host!.url), {
    headers: connection.host!.authorization ? { authorization: connection.host!.authorization } : {},
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Redcode did not return the Design review link (${response.status})`)
  return Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }))(await response.json()).url
}

/** The renderer's private HTTP calls to the app; browser tickets never authorize these. */
export async function call<A>(
  connection: Connection,
  sessionID: string,
  route: string,
  schema: Schema.Codec<A, unknown, never, never>,
  input?: unknown,
  signal?: AbortSignal,
) {
  const response = await fetch(new URL(`/design/session/${encodeURIComponent(sessionID)}${route}`, connection.url), {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    method: input === undefined ? "GET" : "POST",
    body: input === undefined ? undefined : JSON.stringify(input),
    headers: {
      authorization: `Bearer ${connection.token}`,
      ...(input === undefined ? {} : { "content-type": "application/json" }),
    },
  })
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const failure = Option.getOrUndefined(Schema.decodeUnknownOption(Failure)(payload))
    throw new Design.Error(
      failure ?? { code: "unavailable", message: `The design app answered HTTP ${response.status}` },
    )
  }
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(schema)(payload))
  if (decoded === undefined)
    throw new Design.Error({ code: "unavailable", message: "The design app returned an invalid response" })
  return decoded
}

/** Legacy prototype assets stay in the Design app instead of the Redcode CLI binary. */
export async function vendor(connection: Connection, name: string) {
  if (!["tailwind.js", "daisyui.css", "daisyui-themes.css", "mermaid.js"].includes(name))
    throw new Design.Error({ code: "invalid", message: `Unknown Design vendor asset: ${name}` })
  const response = await fetch(new URL(`/app/vendor/${name}`, connection.url), {
    headers: { authorization: `Bearer ${connection.token}` },
  })
  if (!response.ok)
    throw new Design.Error({
      code: "unavailable",
      message: `The Design app did not serve ${name}: HTTP ${response.status}`,
    })
  return response.text()
}
