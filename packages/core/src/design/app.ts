export * as DesignApp from "./app"

import path from "node:path"
import { closeSync, existsSync, openSync } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import { Effect, Option, Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { reviewCopy } from "@reddb-io/redcode-design/copy"
import { designWaiting, WAITING_CSP } from "@reddb-io/redcode-design/waiting"
import { Global } from "../global"
import { Database } from "../database/database"
import { InstallationVersion } from "../installation/version"
import { Flock } from "../util/flock"
import { DesignAppBinary } from "./app-binary"

/**
 * The contract between redcode and the design app (`redcode-design`), the separate process that serves
 * Design's review surface and runs its builds, renders and exports. redcode starts it on demand,
 * finds it again through a registration file, and talks to it with a shared token; the app reaches the
 * conversation back through redcode's `design.host` routes.
 */

/** Bumped whenever routes or payloads between redcode and the design app change incompatibly. */
export const PROTOCOL = 2

/** Minutes without review tabs, requests or running jobs before the app exits on its own. */
export const IDLE_MINUTES = 10

export const Registration = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  pid: Schema.Int,
  version: Schema.String,
  protocol: Schema.Int,
})
export type Registration = typeof Registration.Type

export const Health = Schema.Struct({
  healthy: Schema.Literal(true),
  protocol: Schema.Int,
  version: Schema.String,
  pid: Schema.Int,
})
export type Health = typeof Health.Type

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

export async function register(info: Omit<Registration, "id" | "version" | "protocol">, file = paths().registration) {
  const value: Registration = {
    id: crypto.randomUUID(),
    version: InstallationVersion,
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
}

const launches = new Map<string, Promise<{ url: string; token: string }>>()

/**
 * The running design app, started when none answers. A registration counts only while its process
 * lives, it answers its health check with this token, and it speaks this protocol; an app of another
 * protocol is asked to stop and a new one takes over the registration. Callers in this process share
 * one launch, so a review link opened during a first-use download waits on that download.
 */
export function ensure(input: EnsureInput) {
  const key = paths(input.state).registration
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
  const current = await reusable(files.registration, secret)
  if (current) return { url: current.url, token: secret }
  return Flock.withLock(
    `design-app:${files.registration}`,
    async () => {
      // Another redcode may have started one while this one waited for the lock.
      const started = await reusable(files.registration, secret)
      if (started) return { url: started.url, token: secret }
      DesignAppBinary.report({ phase: "start", received: 0, started: Date.now() })
      const launch =
        typeof input.command === "function"
          ? await input.command()
          : (input.command ?? (await DesignAppBinary.command({ protocol: PROTOCOL })))
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
        if (info && info.pid === child.pid && (await health(info.url, secret))?.protocol === PROTOCOL)
          return { url: info.url, token: secret }
        await sleep(100)
      }
      child.kill("SIGTERM")
      throw new Error(`The design app did not register in time; see ${files.log}`)
    },
    { timeoutMs: (input.timeout ?? 30_000) + 5_000 },
  ).finally(() => DesignAppBinary.report())
}

async function reusable(file: string, secret: string) {
  const info = await registration(file)
  if (!info || !alive(info.pid)) return undefined
  const answer = await health(info.url, secret)
  if (!answer || answer.pid !== info.pid) return undefined
  if (answer.protocol === PROTOCOL && info.protocol === PROTOCOL) return info
  // Another protocol: authenticated by the token, so it is ours to stop; the new app replaces it.
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

/** The running design app, started when none answers, with the version `design.app.version` names. */
export const connect = Effect.fn("DesignApp.connect")(function* (
  input: { readonly host?: Host; readonly version?: string; readonly state?: string } = {},
) {
  const host = input.host ?? served
  if (!host)
    return yield* new Design.Error({
      code: "unavailable",
      message:
        "Design runs in the design app, which reaches the conversation through redcode's server; none listens here",
    })
  const started = yield* Effect.tryPromise({
    try: () =>
      ensure({
        host: host.url,
        state: input.state,
        command: () => DesignAppBinary.command({ protocol: PROTOCOL, version: input.version }),
        // The app opens this redcode's database file, whatever its release channel names it.
        env: { REDCODE_DB: Database.path() },
      }),
    catch: (cause) =>
      new Design.Error({
        code: "unavailable",
        message: `The design app did not start: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  })
  return { ...started, host } satisfies Connection
})

/** The app that runs now, if any, without starting one. */
export async function running(state?: string): Promise<Connection | undefined> {
  const files = paths(state)
  const secret = await token(files.token)
  const info = await reusable(files.registration, secret)
  return info ? { url: info.url, token: secret } : undefined
}

/** A page of the session on the app, with a ticket that lets the browser in. */
export const link = Effect.fn("DesignApp.link")(function* (
  connection: Connection,
  sessionID: string,
  route = "/review",
  search: Record<string, string | undefined> = {},
) {
  // Tells the app which redcode serves this session before a browser asks it for the feed.
  yield* send(connection, sessionID, "/attach", { method: "POST" })
  const url = new URL(`/design/session/${encodeURIComponent(sessionID)}${route}`, connection.url)
  for (const [key, value] of Object.entries(search)) if (value !== undefined) url.searchParams.set(key, value)
  url.searchParams.set("ticket", ticket(connection.token, sessionID))
  return url.toString()
})

/**
 * Where a review link sends the browser: the page on the design app once it runs, or, while this process
 * still downloads or starts it, a waiting page that shows how far that got and reloads itself; a failure
 * to start shows why, with Retry, instead of a connection error.
 */
export const open = Effect.fn("DesignApp.open")(function* (input: {
  readonly host: Host
  readonly sessionID: string
  readonly route: string
  readonly search?: Record<string, string | undefined>
}) {
  const attempt = yield* connect({ host: input.host }).pipe(
    Effect.flatMap((connection) => link(connection, input.sessionID, input.route, input.search)),
    Effect.map((url): { readonly url?: string; readonly error?: string } => ({ url })),
    Effect.timeoutOption("2 seconds"),
    Effect.catch((error) =>
      Effect.succeed(Option.some<{ readonly url?: string; readonly error?: string }>({ error: error.message })),
    ),
  )
  const outcome = Option.getOrUndefined(attempt)
  const url = outcome?.url
  if (url) return { kind: "redirect" as const, url }
  const progress = DesignAppBinary.progress()
  const html = designWaiting(reviewCopy, {
    phase: outcome?.error ? "failed" : (progress?.phase ?? "start"),
    version: progress?.version,
    amount: progress?.phase === "download" ? DesignAppBinary.amount(progress) : undefined,
    percent: progress?.total ? (progress.received / progress.total) * 100 : undefined,
    elapsed: progress ? Math.floor((Date.now() - progress.started) / 1000) : undefined,
    message: outcome?.error,
  })
  return {
    kind: "page" as const,
    html,
    status: outcome?.error ? 503 : 200,
    headers: { "cache-control": "no-store", "content-security-policy": WAITING_CSP },
  }
})

export const publish = (
  connection: Connection,
  sessionID: string,
  id: Design.ID,
  input: { readonly name: string; readonly tooling: boolean },
) => call(connection, sessionID, `/${id}/revision`, Design.Revision, { method: "POST", body: input })

export const restore = (
  connection: Connection,
  sessionID: string,
  id: Design.ID,
  input: { readonly revision: string; readonly tooling: boolean },
) => call(connection, sessionID, `/${id}/restore`, Design.Revision, { method: "POST", body: input })

export const render = (connection: Connection, sessionID: string, id: Design.ID, input: Design.Render) =>
  call(connection, sessionID, `/${id}/job`, Design.Job, { method: "POST", body: input })

export const jobs = (connection: Connection, sessionID: string, id: Design.ID) =>
  call(connection, sessionID, `/${id}/job`, Schema.Array(Design.Job))

export const cancel = (connection: Connection, sessionID: string, id: Design.ID, jobID: string) =>
  call(connection, sessionID, `/${id}/job/${encodeURIComponent(jobID)}/cancel`, Design.Job, { method: "POST" })

/** A vendor asset (Tailwind, DaisyUI, Mermaid) a pre-0.22 prototype referenced, served by the app. */
export const vendor = (connection: Connection, name: string) =>
  request(connection, `/app/vendor/${encodeURIComponent(name)}`, {}).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.promise(() => response.text())
        : Effect.fail(new Design.Error({ code: "not-found", message: `The design app has no vendor asset ${name}` })),
    ),
  )

const call = <A>(
  connection: Connection,
  sessionID: string,
  route: string,
  schema: Schema.Codec<A, unknown, never, never>,
  init: { readonly method?: string; readonly body?: unknown } = {},
) =>
  send(connection, sessionID, route, init).pipe(
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: () =>
          new Design.Error({ code: "unavailable", message: `The design app answered ${response.status} without JSON` }),
      }).pipe(Effect.flatMap((payload) => (response.ok ? decode(schema, payload) : Effect.fail(failure(payload))))),
    ),
  )

const send = (
  connection: Connection,
  sessionID: string,
  route: string,
  init: { readonly method?: string; readonly body?: unknown },
) => request(connection, `/design/session/${encodeURIComponent(sessionID)}${route}`, init)

const request = (connection: Connection, route: string, init: { readonly method?: string; readonly body?: unknown }) =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(new URL(route, connection.url), {
        method: init.method ?? "GET",
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal,
        headers: {
          authorization: `Bearer ${connection.token}`,
          ...(connection.host ? { [HOST_HEADER]: connection.host.url } : {}),
          ...(connection.host?.authorization ? { [HOST_AUTHORIZATION_HEADER]: connection.host.authorization } : {}),
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
      }),
    catch: (cause) =>
      new Design.Error({
        code: "unavailable",
        message: `The design app did not answer: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  })

const decode = <A>(schema: Schema.Codec<A, unknown, never, never>, payload: unknown) =>
  Schema.decodeUnknownEffect(schema)(payload).pipe(
    Effect.mapError(
      (error) => new Design.Error({ code: "unavailable", message: `The design app answered: ${error.message}` }),
    ),
  )

const Failure = Schema.Struct({
  code: Schema.Literals(["not-found", "conflict", "invalid", "unavailable"]),
  message: Schema.String,
})

function failure(payload: unknown) {
  const decoded = Schema.decodeUnknownOption(Failure)(payload)
  if (Option.isSome(decoded)) return new Design.Error(decoded.value)
  return new Design.Error({ code: "unavailable", message: "The design app failed without saying why" })
}
