export * as Usage from "./usage"

import { mkdirSync } from "fs"
import { join } from "path"
import { open } from "#usage-sidecar"
import { Global } from "../global"
import type { SidecarStore } from "./sidecar-store"

/**
 * The USAGE SIDECAR: a second, tiny SQLite file carrying only what a usage report needs — tokens, cost, model,
 * provider and timestamps, one row per assistant message.
 *
 * It exists so token accounting survives the storage underneath it. The session store is redcode's own and will
 * change; this file is a stable, documented contract with the outside world, and it is written in the layout
 * OpenCode uses, which `ccusage` already reads:
 *
 *   ~/.red/code/data/usage/opencode.db   →   ccusage opencode daily
 *
 * with `OPENCODE_DATA_DIR` pointing at the directory (it takes a comma-separated list, so a machine that also runs
 * OpenCode keeps both sources). Nothing here depends on ccusage, and ccusage needs no redcode-specific code.
 *
 * The sidecar never carries message content: prompts, tool output and file paths stay in the session store.
 */
const DIRECTORY = "usage"
const FILENAME = "opencode.db"

/** Every field the reader consumes, and nothing else. */
export interface Entry {
  readonly id: string
  readonly sessionID: string
  readonly timeCreated: number
  readonly timeCompleted?: number | undefined
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
}

export function path() {
  return join(Global.Path.data, DIRECTORY, FILENAME)
}

/**
 * On unless `REDCODE_DISABLE_USAGE_SIDECAR` says otherwise. Read per call rather than captured at import like
 * `Flag`: the sidecar is opened lazily, long after start-up, and a test that flips the variable should be obeyed.
 */
export function enabled() {
  const flag = process.env["REDCODE_DISABLE_USAGE_SIDECAR"]?.toLowerCase()
  return flag !== "1" && flag !== "true"
}

let store: SidecarStore | undefined
let broken = false
let failure: unknown

/** The error that turned the sidecar off, for a caller that wants to report it once. Cleared by `reset`. */
export function lastError() {
  return failure
}

function handle() {
  if (broken || !enabled()) return undefined
  if (store) return store
  try {
    mkdirSync(join(Global.Path.data, DIRECTORY), { recursive: true })
    store = open(path())
    return store
  } catch (error) {
    // A usage mirror is never worth failing a turn over: give up for the process and keep going.
    broken = true
    failure = error
    return undefined
  }
}

/**
 * Mirror one assistant message. Called on the same event that persists the message, so the sidecar tracks the
 * session store row by row; a re-published message updates its row instead of adding one.
 */
export function record(entry: Entry) {
  const target = handle()
  if (!target) return
  try {
    target.upsert({
      id: entry.id,
      sessionID: entry.sessionID,
      timeCreated: entry.timeCreated,
      data: JSON.stringify({
        id: entry.id,
        sessionID: entry.sessionID,
        role: "assistant",
        modelID: entry.modelID,
        providerID: entry.providerID,
        cost: entry.cost,
        tokens: entry.tokens,
        time: { created: entry.timeCreated, completed: entry.timeCompleted },
      }),
    })
  } catch (error) {
    broken = true
    failure = error
  }
}

/**
 * Mirror a persisted message when it carries usage. Answers `false` when the sidecar just gave up (so a caller can
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
  }
}) {
  const info = input.info
  if (info.role !== "assistant") return undefined
  const tokens = info.tokens
  const used =
    (tokens?.input ?? 0) + (tokens?.output ?? 0) + (tokens?.reasoning ?? 0) +
    (tokens?.cache?.read ?? 0) + (tokens?.cache?.write ?? 0)
  // A turn is mirrored once it has numbers: the same message is published several times while it streams, and the
  // early publications carry no usage yet.
  if (used === 0 && (info.cost ?? 0) === 0) return undefined
  if (!enabled() || broken) return broken ? false : undefined
  record({
    id: input.id,
    sessionID: input.sessionID,
    timeCreated: input.timeCreated,
    timeCompleted: info.time?.completed,
    modelID: info.modelID,
    providerID: info.providerID,
    cost: info.cost,
    tokens,
  })
  return !broken
}

/** Test seam: drop the cached handle so a later call reopens (and re-reads the configured path). */
export function reset() {
  try {
    store?.close()
  } catch {}
  store = undefined
  broken = false
  failure = undefined
}
