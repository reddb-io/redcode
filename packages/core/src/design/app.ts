export * as DesignApp from "./app"

import path from "node:path"
import { closeSync, existsSync, openSync } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import { Option, Schema } from "effect"
import { Global } from "../global"
import { InstallationVersion } from "../installation/version"
import { Flock } from "../util/flock"

/**
 * The contract between redcode and the design app (`redcode-design`), the separate process that serves
 * Design's review surface and runs its builds, renders and exports. redcode starts it on demand,
 * finds it again through a registration file, and talks to it with a shared token; the app reaches the
 * conversation back through redcode's `design.host` routes.
 */

/** Bumped whenever routes or payloads between redcode and the design app change incompatibly. */
export const PROTOCOL = 1

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

/**
 * How to start the app: `REDCODE_DESIGN_BIN`, else its source in this checkout run with Bun. Nothing
 * in a compiled redcode without the variable: Design then runs inside redcode.
 */
export function command(): string[] | undefined {
  const bin = process.env.REDCODE_DESIGN_BIN?.trim()
  if (bin) return [bin]
  const entry = path.resolve(import.meta.dir, "../../../design-app/src/index.ts")
  if (!existsSync(entry)) return undefined
  if (path.basename(process.execPath).replace(/\.exe$/, "") !== "bun") return undefined
  return [process.execPath, entry]
}

export interface EnsureInput {
  /** redcode's server: where the app reaches `design.host` for the sessions it serves. */
  readonly host: string
  readonly command?: readonly string[]
  readonly state?: string
  readonly idleMinutes?: number
  /** How long a new app has to register. */
  readonly timeout?: number
  readonly env?: Record<string, string | undefined>
}

/**
 * The running design app, started when none answers. A registration counts only while its process
 * lives, it answers its health check with this token, and it speaks this protocol; an app of another
 * protocol is asked to stop and a new one takes over the registration.
 */
export async function ensure(input: EnsureInput) {
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
      const launch = input.command ?? command()
      if (!launch?.length) throw new Error("The design app is not available in this installation")
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
        if (info?.pid === child.pid && (await health(info.url, secret))?.protocol === PROTOCOL)
          return { url: info.url, token: secret }
        await sleep(100)
      }
      child.kill("SIGTERM")
      throw new Error(`The design app did not register in time; see ${files.log}`)
    },
    { timeoutMs: (input.timeout ?? 30_000) + 5_000 },
  )
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
