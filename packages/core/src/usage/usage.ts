export * as Usage from "./usage"

import { existsSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { open } from "#usage-sidecar"
import { Global } from "../global"
import type { SidecarStore } from "./sidecar-store"

/**
 * USAGE MIRRORS: token accounting written a second time, outside the session store, so a usage reporter can read
 * it without knowing anything about redcode.
 *
 * Two targets, both carrying only what a report needs — tokens, cost, model, provider, timestamps — and never a
 * prompt, a tool result or a file path:
 *
 *  - OUR SIDECAR, `~/.red/code/data/usage/opencode.db`, in OpenCode's layout, which `ccusage` reads when pointed
 *    at the directory. It is ours, so it survives whatever the session store becomes.
 *  - THE FAN-OUT into OpenCode's own database, when one exists, so `ccusage opencode` finds redcode's usage with
 *    no configuration at all. OpenCode's `message` rows are keyed to `session`, and `session` to `project`, so a
 *    fan-out writes those two rows as well; every id it introduces there carries the `redcode` marker below, and
 *    the writes are INSERT OR IGNORE — this process adds rows and never edits the other application's.
 *
 * The fan-out is why the mirrors exist at all in another app's file, and it is the part to switch off first if it
 * ever misbehaves: `REDCODE_DISABLE_USAGE_FANOUT=1`. `REDCODE_DISABLE_USAGE_SIDECAR=1` turns off both.
 */
const DIRECTORY = "usage"
const FILENAME = "opencode.db"

/** Every id this module introduces into a foreign database starts with it, so the rows are identifiable there. */
export const MARKER = "redcode"

export interface Entry {
  readonly id: string
  readonly sessionID: string
  readonly timeCreated: number
  readonly timeUpdated?: number | undefined
  readonly modelID?: string | undefined
  readonly providerID?: string | undefined
  readonly cost?: number | undefined
  readonly tokens?:
    | {
        readonly input?: number | undefined
        readonly output?: number | undefined
        readonly reasoning?: number | undefined
        readonly cache?: { readonly read?: number | undefined; readonly write?: number | undefined } | undefined
      }
    | undefined
  /** The working directory the turn ran in, when the message carries one: the fan-out's project and session need it. */
  readonly directory?: string | undefined
  readonly title?: string | undefined
  readonly version?: string | undefined
}

export function path() {
  return join(Global.Path.data, DIRECTORY, FILENAME)
}

/**
 * OpenCode's own database, discovered the way OpenCode itself resolves it. Answers a path only when the file is
 * already there: creating it would mean inventing a schema for an application that is not installed.
 */
export function fanoutPath() {
  const configured = process.env["OPENCODE_DATA_DIR"]
  const dataHome = process.env["XDG_DATA_HOME"]
  const home = configured ?? join(dataHome && dataHome.startsWith("/") ? dataHome : join(homedir(), ".local", "share"), "opencode")
  const file = join(home, FILENAME)
  return existsSync(file) ? file : undefined
}

function on(name: string) {
  const flag = process.env[name]?.toLowerCase()
  return flag !== "1" && flag !== "true"
}

/** On unless disabled. Read per call rather than captured at import: the mirrors open lazily, long after start-up. */
export function enabled() {
  return on("REDCODE_DISABLE_USAGE_SIDECAR")
}

export function fanoutEnabled() {
  return enabled() && on("REDCODE_DISABLE_USAGE_FANOUT")
}

interface Target {
  store: SidecarStore
  own: boolean
  sessions: Set<string>
}

let targets: Target[] | undefined
let failure: unknown

/** The error that turned a mirror off, for a caller that wants to report it once. Cleared by `reset`. */
export function lastError() {
  return failure
}

function openTargets() {
  if (targets) return targets
  const opened: Target[] = []
  if (enabled()) {
    try {
      mkdirSync(join(Global.Path.data, DIRECTORY), { recursive: true })
      opened.push({ store: open(path(), { own: true }), own: true, sessions: new Set() })
    } catch (error) {
      failure = error
    }
  }
  if (fanoutEnabled()) {
    const file = fanoutPath()
    if (file) {
      try {
        opened.push({ store: open(file, { own: false }), own: false, sessions: new Set() })
      } catch (error) {
        failure = error
      }
    }
  }
  targets = opened
  return targets
}

/** `redcode` in front of the foreign id, so a row this module wrote is recognizable in the other application. */
function marked(kind: "ses" | "prj", value: string) {
  return `${kind}_${MARKER}_${value.replace(/^[a-z]+_/, "")}`
}

export function record(entry: Entry) {
  const opened = openTargets()
  if (opened.length === 0) return
  const timeUpdated = entry.timeUpdated ?? entry.timeCreated
  const directory = entry.directory ?? Global.Path.data
  const data = JSON.stringify({
    id: entry.id,
    sessionID: entry.sessionID,
    role: "assistant",
    modelID: entry.modelID,
    providerID: entry.providerID,
    cost: entry.cost,
    tokens: entry.tokens,
    time: { created: entry.timeCreated, completed: entry.timeUpdated },
  })
  for (const target of opened) {
    try {
      if (target.own) {
        target.store.message({
          id: entry.id,
          sessionID: entry.sessionID,
          timeCreated: entry.timeCreated,
          timeUpdated,
          data,
        })
        continue
      }
      // The fan-out target keys messages to a session and a project it does not have: write those first, once per
      // session per process. `INSERT OR IGNORE` keeps a re-run from touching rows that are already there.
      const sessionID = marked("ses", entry.sessionID)
      if (!target.sessions.has(sessionID)) {
        const projectID = marked("prj", MARKER)
        target.store.project({
          id: projectID,
          worktree: directory,
          timeCreated: entry.timeCreated,
          timeUpdated,
        })
        target.store.session({
          id: sessionID,
          projectID,
          slug: "",
          directory,
          title: entry.title ?? `${MARKER}: ${entry.sessionID}`,
          version: entry.version ?? MARKER,
          timeCreated: entry.timeCreated,
          timeUpdated,
        })
        target.sessions.add(sessionID)
      }
      target.store.message({
        id: `${MARKER}_${entry.id.replace(/^[a-z]+_/, "")}`,
        sessionID,
        timeCreated: entry.timeCreated,
        timeUpdated,
        data: data.replace(entry.sessionID, sessionID),
      })
    } catch (error) {
      // A usage mirror is never worth failing a turn over: drop this target and keep the others.
      failure = error
      targets = opened.filter((candidate) => candidate !== target)
      try {
        target.store.close()
      } catch {}
    }
  }
}

/**
 * Mirror a persisted message when it carries usage. Answers `false` when a mirror just gave up (so a caller can
 * report it once), `true` when the row was written, and `undefined` when there was nothing to mirror — a user
 * message, or an assistant turn that reported no tokens.
 */
export function recordMessage(input: {
  id: string
  sessionID: string
  timeCreated: number
  info: {
    readonly role?: string | undefined
    readonly cost?: number | undefined
    readonly tokens?: Entry["tokens"]
    readonly modelID?: string | undefined
    readonly providerID?: string | undefined
    readonly time?: { readonly created?: number | undefined; readonly completed?: number | undefined } | undefined
    readonly path?: { readonly cwd?: string | undefined; readonly root?: string | undefined } | undefined
  }
}) {
  const info = input.info
  if (info.role !== "assistant") return undefined
  const tokens = info.tokens
  const used =
    (tokens?.input ?? 0) +
    (tokens?.output ?? 0) +
    (tokens?.reasoning ?? 0) +
    (tokens?.cache?.read ?? 0) +
    (tokens?.cache?.write ?? 0)
  // A turn is mirrored once it has numbers: the same message is published several times while it streams, and the
  // early publications carry no usage yet.
  if (used === 0 && (info.cost ?? 0) === 0) return undefined
  if (!enabled()) return undefined
  const before = failure
  record({
    id: input.id,
    sessionID: input.sessionID,
    timeCreated: input.timeCreated,
    timeUpdated: info.time?.completed,
    modelID: info.modelID,
    providerID: info.providerID,
    cost: info.cost,
    tokens,
    directory: info.path?.root ?? info.path?.cwd,
  })
  return failure === before
}

/** Test seam: drop the cached handles so a later call reopens (and re-reads the configured paths). */
export function reset() {
  for (const target of targets ?? []) {
    try {
      target.store.close()
    } catch {}
  }
  targets = undefined
  failure = undefined
}
