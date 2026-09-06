/**
 * What a review remembers between processes.
 *
 * The registry's map lives in memory and dies with the server. A person's tab does not, and the
 * agent's next `design_preview` should find the same prototype where it left it — so each one
 * writes a small sidecar next to itself, and an index in the data directory says which sidecars
 * exist. Both are plain JSON, written atomically, and both are treated as hints: a sidecar that
 * cannot be read costs nothing but the memory that was in it.
 */

import path from "path"
import { Global } from "@reddb-io/redcode-core/global"

/** The directory a prototype keeps its own state in; never served, never part of the design. */
export const DIR = ".review"
export const FILE = "state.json"
export const INDEX = path.join(Global.Path.data, "designs", "registry.json")

/** How much conversation a review keeps; older entries fall off the front. */
export const MAX_CHAT = 200

export type EndedBy = "user" | "agent"

export interface ChatEntry {
  readonly role: "user" | "agent"
  readonly text: string
  readonly at: number
}

export interface Ended {
  readonly by: EndedBy
  readonly at: number
}

export interface Persisted {
  readonly id: string
  readonly sessionID: string
  readonly root: string
  readonly name: string
  readonly token: string
  readonly revision: number
  readonly ended?: Ended
  readonly chat: readonly ChatEntry[]
}

export interface IndexEntry {
  readonly root: string
  readonly sessionID: string
}

export const file = (root: string) => path.join(root, DIR, FILE)

export function serialize(state: Persisted) {
  return JSON.stringify(state, null, 2) + "\n"
}

const str = (value: unknown) => (typeof value === "string" ? value : "")

/** Anything that is not the shape we wrote is treated as nothing; a corrupt sidecar is not a crash. */
export function parse(raw: string): Persisted | undefined {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!data || typeof data !== "object") return undefined
  const r = data as Record<string, unknown>
  const id = str(r.id)
  const sessionID = str(r.sessionID)
  const root = str(r.root)
  const token = str(r.token)
  if (!id || !sessionID || !root || !token) return undefined
  const ended =
    r.ended && typeof r.ended === "object" && (r.ended as Record<string, unknown>).by
      ? {
          by: ((r.ended as Record<string, unknown>).by === "agent" ? "agent" : "user") as EndedBy,
          at: Number((r.ended as Record<string, unknown>).at) || 0,
        }
      : undefined
  const chat: ChatEntry[] = Array.isArray(r.chat)
    ? r.chat.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const c = item as Record<string, unknown>
        const text = str(c.text)
        if (!text) return []
        return [{ role: c.role === "agent" ? ("agent" as const) : ("user" as const), text, at: Number(c.at) || 0 }]
      })
    : []
  return {
    id,
    sessionID,
    root,
    name: str(r.name) || path.basename(root),
    token,
    revision: Number.isInteger(r.revision) && (r.revision as number) > 0 ? (r.revision as number) : 1,
    ...(ended ? { ended } : {}),
    chat: chat.slice(-MAX_CHAT),
  }
}

export function parseIndex(raw: string): Record<string, IndexEntry> {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!data || typeof data !== "object") return {}
  const out: Record<string, IndexEntry> = {}
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue
    const v = value as Record<string, unknown>
    const root = str(v.root)
    const sessionID = str(v.sessionID)
    if (root && sessionID && /^[A-Za-z0-9_-]{1,64}$/.test(id)) out[id] = { root, sessionID }
  }
  return out
}

export * as DesignState from "./state"
