import { afterAll, describe, expect } from "bun:test"
import { Database as SqliteFile } from "bun:sqlite"
import fs from "fs"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Session as SessionNs } from "@/session/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { testEffect } from "../lib/effect"

// A real file rather than the suite's `:memory:` database, so a second connection can hold the
// write lock the way another Redcode process (a `run` worker, `serve`, another TUI) would.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "redcode-session-lock-"))
const filename = path.join(dir, "shared.db")
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      SessionNs.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [Database.node, Database.layerFromPath(filename)],
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

/** The other process: holds the write lock with an uncommitted metadata write until released. */
const otherProcess = (sessionID: string, metadata: Record<string, unknown>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const other = new SqliteFile(filename)
      other.run("PRAGMA busy_timeout = 0")
      other.run("BEGIN IMMEDIATE")
      other.run("UPDATE session SET metadata = ? WHERE id = ?", [JSON.stringify(metadata), sessionID])
      const release = setTimeout(() => other.run("COMMIT"), 150)
      return { other, release }
    }),
    ({ other, release }) =>
      Effect.sync(() => {
        clearTimeout(release)
        if (other.inTransaction) other.run("ROLLBACK")
        other.close()
      }),
  )

describe("session writes across processes", () => {
  it.instance("a touch waits for another process's metadata write instead of writing over it", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const { db } = yield* Database.Service
      // The other connection lives on this thread: a statement spinning on the busy handler for
      // the full timeout would hold up the very commit it waits for, so keep the spin short and
      // let the transaction retry do the waiting.
      yield* db.run(sql`PRAGMA busy_timeout = 20`)
      // The session already carries spend: a stale read would write the old figure back. (A row
      // without metadata would not show the bug, since an absent field is left out of the update.)
      const info = yield* session.create({ metadata: { spend: { total: 4 } } })
      const spend = { spend: { total: 5 } }

      yield* otherProcess(info.id, spend)
      // A read outside the write lock would still see total 4 and write it back over the 5.
      yield* session.touch(info.id)

      const after = yield* session.get(info.id)
      expect(after.metadata).toEqual(spend)
      expect(after.time.updated).toBeGreaterThanOrEqual(info.time.updated)
    }),
  )

  it.instance("a metadata update starts from what another process committed meanwhile", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const { db } = yield* Database.Service
      yield* db.run(sql`PRAGMA busy_timeout = 20`)
      const info = yield* session.create({ metadata: { spend: { total: 4 } } })

      yield* otherProcess(info.id, { spend: { total: 4 }, goal: { status: "paused" } })
      const next = yield* session.updateMetadata(info.id, (metadata) => ({ ...metadata, spend: { total: 5 } }))

      expect(next).toEqual({ goal: { status: "paused" }, spend: { total: 5 } })
      expect((yield* session.get(info.id)).metadata).toEqual(next)
    }),
  )
})
