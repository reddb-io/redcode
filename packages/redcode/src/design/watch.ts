/**
 * Noticing that the agent changed the prototype.
 *
 * A fingerprint of the directory — every servable file's path, size and mtime — compared on a
 * short interval while someone is looking. Polling rather than a native watcher because it costs
 * nothing when no review surface is connected, needs no binding, and behaves the same on every
 * platform; a prototype is a handful of files, so a walk is cheap. What the poll produces is a
 * revision bump, which the shell turns into a reload.
 */

import { promises as fs } from "node:fs"
import path from "path"
import { DIR as STATE_DIR } from "./state"

/** How often a watched prototype is looked at, and how long a burst of saves is allowed to settle. */
export const POLL_MS = 1_000
export const DEBOUNCE_MS = 100
/** Wider while a queued batch of layout fixes is outstanding, so related saves coalesce into one reload. */
export const BATCH_DEBOUNCE_MS = 900
/** A prototype bigger than this is fingerprinted by its first entries only; it is not a prototype. */
export const MAX_ENTRIES = 2_000

const SKIP = new Set([".git", "node_modules", "dist", "build", STATE_DIR])

/** One string per file, joined: cheap to compare, meaningless to read. */
export async function fingerprint(root: string): Promise<string> {
  const lines: string[] = []
  const walk = async (dir: string) => {
    if (lines.length >= MAX_ENTRIES) return
    let entries: import("node:fs").Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (lines.length >= MAX_ENTRIES) return
      if (SKIP.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = await fs.stat(full)
        lines.push(`${path.relative(root, full)}:${stat.size}:${Math.floor(stat.mtimeMs)}`)
      } catch {
        // Gone between readdir and stat: the next poll sees the truth.
      }
    }
  }
  await walk(root)
  return lines.join("\n")
}

export * as DesignWatch from "./watch"
