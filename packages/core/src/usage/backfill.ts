export * as UsageBackfill from "./backfill"

import { readdirSync } from "fs"
import { join } from "path"
import { openStore } from "#usage-sidecar"
import { Global } from "../global"
import { Usage } from "./usage"

/**
 * BACKFILL: replay the usage already sitting in the session stores through the same mirroring path a live turn
 * takes, so a machine that ran before the mirrors existed can still report on its history.
 *
 * It reads every session store in the data directory — one per release channel, plus the OpenCode-named ones an
 * older install left behind — and mirrors each assistant message that carries usage. Mirrors upsert by message id,
 * so running this twice changes nothing the first run did not already write.
 */
const STORE_NAME = /^(redcode|opencode)[a-zA-Z0-9._-]*\.db$/

export interface Result {
  /** Session stores read, in the order they were found. */
  readonly stores: readonly string[]
  /** Messages that reached the mirrors. */
  readonly mirrored: number
  /** Rows with nothing to mirror: user messages, and assistant turns that reported no usage. */
  readonly skipped: number
}

/** The session stores this installation has, newest data first is not needed — the mirrors upsert by id. */
export function stores(directory = Global.Path.data) {
  try {
    return readdirSync(directory)
      .filter((name) => STORE_NAME.test(name))
      .sort()
      .map((name) => join(directory, name))
  } catch {
    return []
  }
}

export function run(input: { directory?: string; onStore?: (file: string, rows: number) => void } = {}): Result {
  const found = stores(input.directory)
  let mirrored = 0
  let skipped = 0
  const read: string[] = []
  for (const file of found) {
    const store = openStore(file)
    if (!store) continue
    try {
      const rows = store.messages()
      read.push(file)
      input.onStore?.(file, rows.length)
      for (const row of rows) {
        let info: unknown
        try {
          info = JSON.parse(row.data)
        } catch {
          skipped += 1
          continue
        }
        const result = Usage.recordMessage({
          id: row.id,
          sessionID: row.sessionID,
          timeCreated: row.timeCreated,
          info: info as Parameters<typeof Usage.recordMessage>[0]["info"],
        })
        if (result === undefined) skipped += 1
        else if (result) mirrored += 1
        // `false` means a mirror gave up mid-run; Usage.lastError() carries the reason and the caller reports it.
      }
    } finally {
      store.close()
    }
  }
  return { stores: read, mirrored, skipped }
}
