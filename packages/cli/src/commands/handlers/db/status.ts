import { EOL } from "node:os"
import path from "node:path"
import { readdir, stat } from "node:fs/promises"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { Database } from "@opencode/core/database/database"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { select } from "../../../database-selection"

export default Runtime.handler(
  Commands.commands.db.commands.status,
  Effect.fn("cli.db.status")(function* () {
    const global = yield* Global.Service
    const selected = yield* Effect.promise(() => select(global))
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.db.all(sql`SELECT 1 AS ok`)
    }).pipe(Effect.provide(Database.layer(selected)))
    const storage = yield* Effect.promise(async () => {
      const size = async (file: string) => (await stat(file).catch(() => undefined))?.size ?? 0
      const backups = (await readdir(global.data).catch(() => []))
        .filter((name) => name === "redcode.db" || name.startsWith("redcode.db.bak-"))
      return {
        databaseBytes: selected.path && selected.path !== ":memory:" ? await size(selected.path) : undefined,
        walBytes: selected.path && selected.path !== ":memory:" ? await size(`${selected.path}-wal`) : undefined,
        legacyBackupBytes: (await Promise.all(backups.map((name) => size(path.join(global.data, name))))).reduce(
          (total, bytes) => total + bytes,
          0,
        ),
        cacheBytes: await directorySize(global.cache),
        snapshotBytes: await directorySize(path.join(global.data, "snapshot")),
      }
    })
    process.stdout.write(
      JSON.stringify(
        { backend: selected.url ? "reddb" : "sqlite", location: selected.url ?? selected.path, connected: true, storage },
        null,
        2,
      ) + EOL,
    )
  }),
)

async function directorySize(directory: string) {
  if (!(await stat(directory).catch(() => undefined))) return 0
  let total = 0
  for await (const file of new Bun.Glob("**/*").scan({ cwd: directory, onlyFiles: true, dot: true }))
    total += (await stat(path.join(directory, file)).catch(() => undefined))?.size ?? 0
  return total
}
