/**
 * Native monitor probes: an HTTP endpoint, a file, or a process, observed in-process on every
 * platform without a shell. Each attempt returns a small `Monitor.ProbeResult` and a one-line
 * summary; neither ever carries a response body beyond a bounded selected value, nor a header value.
 * Permission checks belong to the tool that starts the monitor; nothing here asks.
 */
export * as MonitorProbe from "./monitor-probe"

import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Monitor } from "@reddb-io/redcode-schema/monitor"
import { processInfo, probe as runner } from "./monitor"
import { SafeRegex } from "./safe-regex"

/** The most of a response body an http probe reads. */
export const HTTP_MAX_BYTES = 1_048_576
/** The longest one http attempt may take, redirects included. */
export const HTTP_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5
const VALUE_CHARS = 200
/** Files up to this size are hashed by a `changed` probe, so a rewrite with the same size and mtime still counts. */
export const FILE_HASH_BYTES = 1_048_576
const MAX_PIDS = 10

export type Observation = { output: string; probe: Monitor.ProbeResult }

const clip = (text: string, chars = VALUE_CHARS) => (text.length > chars ? `${text.slice(0, chars)}…` : text)

/** Only a plain variable name is a reference; anything else, such as `{env:*}`, is never expanded. */
const ENV_REFERENCE = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * The `env` permission pattern for sending one variable to one host. Permission patterns treat * and ? as
 * wildcards with no escape, so a name or host that could widen the grant is refused instead of saved.
 */
export function envPermissionPattern(variable: string, host: string) {
  if (!Monitor.ENV_NAME.test(variable))
    throw new Error(`Invalid environment variable name: ${JSON.stringify(variable)}`)
  if (host === "" || /[*?\s]/.test(host)) throw new Error(`Invalid host for an env permission: ${JSON.stringify(host)}`)
  return `${variable}@${host}`
}

/** The environment variables a probe's header values reference, each once. */
export function envNames(headers: Record<string, string> | undefined) {
  return [
    ...new Set(
      Object.values(headers ?? {}).flatMap((value) => [...value.matchAll(ENV_REFERENCE)].map((match) => match[1]!)),
    ),
  ]
}

/**
 * Header values with `{env:NAME}` replaced from `env`. Only the variables in `env` are ever read: a caller
 * passes just the ones a person allowed, so a reference to anything else becomes an empty string.
 */
export function headerValues(headers: Record<string, string> | undefined, env: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [
      name,
      value.replace(ENV_REFERENCE, (_, key: string) => (Object.hasOwn(env, key) ? (env[key] ?? "") : "")),
    ]),
  )
}

async function readBounded(response: Response, max: number) {
  const reader = response.body?.getReader()
  if (!reader) return { text: "", truncated: false }
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  while (true) {
    const next = await reader.read()
    if (next.done) break
    if (size + next.value.byteLength > max) {
      chunks.push(next.value.subarray(0, max - size))
      size = max
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(next.value)
    size += next.value.byteLength
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated }
}

function select(body: unknown, keys: (string | number)[]) {
  let current: unknown = body
  for (const key of keys) {
    if (current === null || typeof current !== "object") return undefined
    if (typeof key === "number" && !Array.isArray(current)) return undefined
    if (!Object.hasOwn(current, key)) return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

function equal(value: unknown, expected: string | number | boolean) {
  if (typeof value === typeof expected) return value === expected
  if (value !== null && typeof value === "object") return JSON.stringify(value) === String(expected)
  return String(value) === String(expected)
}

/** Where a redirect may be followed: the same host and port, never from https down to http. */
function sameSite(from: URL, to: URL) {
  if (from.host !== to.host) return false
  return from.protocol === to.protocol || (from.protocol === "http:" && to.protocol === "https:")
}

export type HttpOptions = {
  timeoutMs?: number
  /** The environment variables header values may read; nothing else is read. */
  env?: Record<string, string | undefined>
  fetch?: typeof fetch
  /** Whether the permission rules cover a same-host redirect target; a target they do not cover is not followed. */
  allowRedirect?: (url: URL) => boolean
  /** The monitor's own regex matcher; the shared one otherwise. */
  regex?: SafeRegex.Matcher
}

/**
 * One http attempt. Uses the runtime's fetch, which honours HTTP_PROXY, HTTPS_PROXY and NO_PROXY like
 * webfetch does. Redirects are followed only on the same host and only where `allowRedirect` agrees;
 * any other is reported, not followed.
 */
export async function http(probe: Monitor.HttpProbe, options: HttpOptions = {}): Promise<Observation> {
  const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS
  const doFetch = options.fetch ?? fetch
  const signal = AbortSignal.timeout(timeoutMs)
  const headers = headerValues(probe.headers, options.env ?? {})
  const method = probe.method ?? "GET"
  const first = new URL(probe.url)
  let url = first
  try {
    for (let hop = 0; ; hop++) {
      const response = await doFetch(url, { method, headers, redirect: "manual", signal })
      const status = response.status
      const location = response.headers.get("location")
      if (status >= 300 && status < 400 && location) {
        await response.body?.cancel().catch(() => {})
        const next = new URL(location, url)
        const where = `${next.origin}${next.pathname}`
        const refused = !sameSite(first, next)
          ? `not followed, points at another host: ${where}`
          : options.allowRedirect && !options.allowRedirect(next)
            ? `not followed, the webfetch permission does not cover ${where}`
            : undefined
        if (refused)
          return { output: `HTTP ${status}, redirect ${refused}`, probe: { matched: false, status, redirect: refused } }
        if (hop >= MAX_REDIRECTS)
          return {
            output: `HTTP ${status}, too many redirects`,
            probe: { matched: false, status, error: "too many redirects" },
          }
        url = next
        continue
      }
      return await judge(probe, response, options.regex ?? SafeRegex)
    }
  } catch (error) {
    const message =
      signal.aborted || (error instanceof Error && error.name === "TimeoutError")
        ? `no response within ${timeoutMs} ms`
        : clip(error instanceof Error ? error.message : String(error))
    return { output: `HTTP request failed: ${message}`, probe: { matched: false, error: message } }
  }
}

async function judge(
  probe: Monitor.HttpProbe,
  response: Response,
  regex: Pick<SafeRegex.Matcher, "exec">,
): Promise<Observation> {
  const status = response.status
  const statuses = probe.expect_status === undefined ? undefined : [probe.expect_status].flat()
  const statusOk = statuses ? statuses.includes(status) : status >= 200 && status < 300
  const expected = statuses ? statuses.join(" or ") : "2xx"
  const needsBody =
    probe.method !== "HEAD" &&
    (probe.json_path !== undefined ||
      probe.equals !== undefined ||
      probe.contains !== undefined ||
      probe.regex !== undefined)
  if (!needsBody) {
    await response.body?.cancel().catch(() => {})
    return { output: `HTTP ${status} (expected ${expected})`, probe: { matched: statusOk, status } }
  }
  const body = await readBounded(response, HTTP_MAX_BYTES)
  const result: { -readonly [K in keyof Monitor.ProbeResult]: Monitor.ProbeResult[K] } = {
    matched: false,
    status,
    ...(body.truncated ? { truncated: true } : {}),
  }
  const parts = [`HTTP ${status} (expected ${expected})`]
  let subject = body.text
  if (probe.json_path !== undefined) {
    if (body.truncated) {
      const error = `response is larger than ${HTTP_MAX_BYTES} bytes, so json_path cannot be read`
      return { output: `${parts[0]}, ${error}`, probe: { ...result, error } }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body.text)
    } catch {
      return { output: `${parts[0]}, body is not JSON`, probe: { ...result, error: "body is not JSON" } }
    }
    const selected = select(parsed, Monitor.jsonPath(probe.json_path) ?? [])
    if (selected === undefined) {
      parts.push(`${probe.json_path} not found`)
      return { output: parts.join(", "), probe: result }
    }
    const value = clip(JSON.stringify(selected))
    result.value = value
    parts.push(`${probe.json_path} = ${value}`)
    subject = typeof selected === "string" ? selected : JSON.stringify(selected)
    if (probe.equals !== undefined && !equal(selected, probe.equals)) return { output: parts.join(", "), probe: result }
  } else if (probe.equals !== undefined && body.text.trim() !== String(probe.equals)) {
    return { output: `${parts[0]}, body does not equal ${JSON.stringify(probe.equals)}`, probe: result }
  }
  if (probe.equals !== undefined) parts.push(`equals ${JSON.stringify(probe.equals)}`)
  if (probe.contains !== undefined) {
    if (!subject.includes(probe.contains)) return { output: parts.join(", "), probe: result }
    parts.push(`contains ${JSON.stringify(probe.contains)}`)
  }
  if (probe.regex !== undefined) {
    const outcome = await regex.exec(probe.regex, subject.slice(0, Monitor.REGEX_INPUT_CHARS))
    if ("timedOut" in outcome) {
      const error = `${SafeRegex.TIMEOUT_ERROR} after ${SafeRegex.MATCH_TIMEOUT_MS} ms`
      return { output: `${parts.join(", ")}, ${error}`, probe: { ...result, error } }
    }
    if ("error" in outcome || outcome.match === undefined) return { output: parts.join(", "), probe: result }
    parts.push(`regex matched ${JSON.stringify(clip(outcome.match, 80))}`)
  }
  return { output: parts.join(", "), probe: { ...result, matched: statusOk } }
}

export type FileState = { exists: boolean; size?: number; mtime?: number; hash?: string; error?: string }

/**
 * What is at a path now. Symlinks are followed; the caller decides whether their target may be read. The
 * content is read and hashed only when asked (a `changed` probe), and only for files up to 1 MB.
 */
export async function observeFile(target: string, options: { hash?: boolean } = {}): Promise<FileState> {
  try {
    const info = await stat(target)
    const hash =
      options.hash && info.isFile() && info.size <= FILE_HASH_BYTES
        ? createHash("sha256")
            .update(await readFile(target))
            .digest("hex")
        : undefined
    return { exists: true, size: info.size, mtime: info.mtimeMs, ...(hash ? { hash } : {}) }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return { exists: false }
    return { exists: false, error: clip(code ?? String(error)) }
  }
}

/** The verdict on a file observation; `first` is the observation taken when the monitor started, for `changed`. */
export function fileResult(probe: Monitor.FileProbe, now: FileState, first: FileState | undefined): Observation {
  const stats = now.exists
    ? { exists: true, size: now.size, ...(now.mtime !== undefined ? { mtime: Math.round(now.mtime) } : {}) }
    : { exists: false }
  if (now.error)
    return {
      output: `file ${probe.path} could not be read: ${now.error}`,
      probe: { matched: false, ...stats, error: now.error },
    }
  const bigEnough = probe.min_size === undefined || (now.exists && (now.size ?? 0) >= probe.min_size)
  const describe = now.exists ? `file ${probe.path} exists, ${now.size} bytes` : `file ${probe.path} is missing`
  if (probe.state === "exists") return { output: describe, probe: { matched: now.exists && bigEnough, ...stats } }
  if (probe.state === "missing") return { output: describe, probe: { matched: !now.exists, ...stats } }
  const changed =
    first !== undefined &&
    (first.exists !== now.exists || first.size !== now.size || first.mtime !== now.mtime || first.hash !== now.hash)
  return {
    output: changed ? `${describe}, changed since the monitor started` : `${describe}, unchanged`,
    probe: { matched: changed && (now.exists ? bigEnough : probe.min_size === undefined), ...stats },
  }
}

export type ProcessEntry = { pid: number; name: string; command: string }

const currentUid = () => (typeof process.getuid === "function" ? process.getuid() : undefined)

/**
 * The live processes of the current user: `/proc` on Linux, `ps` with LC_ALL=C elsewhere on POSIX, `tasklist`
 * on Windows. Zombies count as exited. Undefined when the listing itself failed.
 */
export function listProcesses(platform: NodeJS.Platform = process.platform): ProcessEntry[] | undefined {
  const entries = listAll(platform)
  // A listing that does not show this very process was filtered or cut short (a tasklist user filter that did
  // not match the account's domain\user form, say). An empty list from it would read as "exited", so it is no
  // answer at all.
  return entries?.some((entry) => entry.pid === process.pid) ? entries : undefined
}

function listAll(platform: NodeJS.Platform): ProcessEntry[] | undefined {
  const uid = currentUid()
  if (platform === "linux") {
    try {
      return readdirSync("/proc").flatMap((entry) => {
        if (!/^\d+$/.test(entry)) return []
        try {
          if (uid !== undefined && statSync(`/proc/${entry}`).uid !== uid) return []
          const stat = readFileSync(`/proc/${entry}/stat`, "utf8")
          if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")) return []
          const name = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"))
          const command = readFileSync(`/proc/${entry}/cmdline`, "utf8").replaceAll("\0", " ").trim()
          return [{ pid: Number(entry), name, command }]
        } catch {
          return []
        }
      })
    } catch {
      return undefined
    }
  }
  const options = { encoding: "utf8" as const, timeout: 5_000, env: { ...process.env, LC_ALL: "C" }, windowsHide: true }
  if (platform === "win32") {
    let user: string
    try {
      user = os.userInfo().username
    } catch {
      return undefined
    }
    const result = runner.spawn("tasklist", ["/FO", "CSV", "/NH", "/FI", `USERNAME eq ${user}`], options)
    if (result.error || result.status !== 0 || typeof result.stdout !== "string") return undefined
    return result.stdout.split(/\r?\n/).flatMap((line) => {
      const match = /^"([^"]*)","(\d+)"/.exec(line)
      if (!match) return []
      return [{ pid: Number(match[2]), name: match[1]!.replace(/\.exe$/i, ""), command: match[1]! }]
    })
  }
  const result = runner.spawn("ps", ["-A", "-ww", "-o", "pid=", "-o", "uid=", "-o", "stat=", "-o", "args="], options)
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") return undefined
  return result.stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!match || match[3]!.startsWith("Z")) return []
    if (uid !== undefined && Number(match[2]) !== uid) return []
    const command = match[4]!.trim()
    return [{ pid: Number(match[1]), name: path.basename(command.split(/\s+/)[0] ?? ""), command }]
  })
}

/**
 * Whether a process matches a probe name. By default the executable name must equal it: the process name, or
 * on POSIX the file name of the command's first word (Linux cuts process names to 15 characters). On Windows
 * the comparison ignores case and `.exe`. With `cmdline`, the command line must contain it. This runtime's own
 * process never matches.
 */
export function matchesName(
  entry: ProcessEntry,
  name: string,
  match: "name" | "cmdline" = "name",
  platform: NodeJS.Platform = process.platform,
) {
  if (entry.pid === process.pid) return false
  const windows = platform === "win32"
  const fold = (text: string) => (windows ? text.replace(/\.exe$/i, "").toLowerCase() : text)
  if (match === "cmdline")
    return windows ? entry.command.toLowerCase().includes(name.toLowerCase()) : entry.command.includes(name)
  const executable = path.basename(entry.command.split(/\s+/)[0] ?? "")
  const candidates = windows ? [entry.name] : [entry.name, executable]
  return candidates.some((candidate) => candidate !== "" && fold(candidate) === fold(name))
}

function zombie(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")
  } catch {
    return false
  }
}

/**
 * Whether a pid runs. Only a definite answer counts: a process whose entry cannot be read (a hidden `/proc`,
 * a Windows access error) is "unknown", which keeps a monitor polling and never counts as exited. `signal`
 * sends signal 0 and is replaceable in tests.
 */
export function pidState(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  signal: (pid: number) => void = (target) => process.kill(target, 0),
): "running" | "exited" | "unknown" {
  if (pid === process.pid) return "running"
  if (platform === "linux" || platform === "darwin") {
    const found = processInfo(pid, platform)
    if (found === "unknown") return "unknown"
    if (found) return "running"
  }
  try {
    signal(pid)
    // Signalable but without a readable entry: a zombie is done; anything else could not be looked at.
    if (platform === "win32") return "running"
    return platform === "linux" && zombie(pid) ? "exited" : "unknown"
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? "exited" : "unknown"
  }
}

export function processCheck(
  probe: Monitor.ProcessProbe,
  platform: NodeJS.Platform = process.platform,
  list: () => ProcessEntry[] | undefined = () => listProcesses(platform),
  signal?: (pid: number) => void,
): Observation {
  if (probe.pid !== undefined) {
    const state = pidState(probe.pid, platform, signal)
    if (state === "unknown") {
      const error = "could not tell whether the process runs"
      return { output: `process ${probe.pid}: ${error}`, probe: { matched: false, error } }
    }
    return {
      output: `process ${probe.pid} ${state === "running" ? "is running" : "is not running"}`,
      probe: { matched: state === probe.state, pids: state === "running" ? [probe.pid] : [] },
    }
  }
  const entries = list()
  if (!entries) {
    const error = "could not list processes"
    return { output: error, probe: { matched: false, error } }
  }
  const match = probe.match ?? "name"
  const pids = entries.filter((entry) => matchesName(entry, probe.name!, match, platform)).map((entry) => entry.pid)
  const running = pids.length > 0
  const what = `${match === "cmdline" ? "command line containing" : "executable named"} ${JSON.stringify(probe.name)}`
  return {
    output: running
      ? `${pids.length} process(es) with a ${what}: ${pids.slice(0, MAX_PIDS).join(", ")}`
      : `no process with a ${what}`,
    probe: { matched: running === (probe.state === "running"), pids: pids.slice(0, MAX_PIDS) },
  }
}
