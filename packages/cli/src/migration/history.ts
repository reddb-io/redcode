import path from "node:path"
import { Effect, Layer, Logger } from "effect"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"

export async function inspectHistory(source: string) {
  const { Database } = await import("bun:sqlite")
  using database = new Database(source, { readonly: true, strict: true })
  const tables = new Set(
    database
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  )
  const currentTable = tables.has("session_v2")
  const completed =
    tables.has("kv") &&
    database
      .query<
        { phase: string },
        []
      >("SELECT json_extract(value, '$.phase') AS phase FROM kv WHERE key = 'migration.v1-v2'")
      .get()?.phase === "completed"
  const oldSessions = tables.has("session")
    ? (database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM session").get()?.count ?? 0)
    : 0
  const redcode =
    !currentTable && ["project", "session", "session_message", "message", "part"].every((name) => tables.has(name))
  const pending = oldSessions > 0 && (!currentTable || !completed)
  const mixed =
    currentTable &&
    !completed &&
    (database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM session_v2").get()?.count ?? 0) > 0
  const format = redcode
    ? "redcode"
    : pending && !mixed && tables.has("message") && tables.has("part")
      ? "database"
      : currentTable && !pending
        ? "current"
        : "unsupported"
  const compatible = format === "redcode" || format === "database"
  return {
    current: format === "current",
    compatible,
    format,
    diagnostics: compatible
      ? []
      : [
          {
            kind: "unsupported" as const,
            path: ["$"],
            message:
              format === "current"
                ? "This database already uses the current structure"
                : "Unsupported or mixed history requires explicit recovery before conversion",
          },
        ],
  }
}

export async function convertHistory(source: string, output: string) {
  const inspection = await inspectHistory(source)
  if (!inspection.compatible) throw new Error("Source history cannot be converted safely")
  if (inspection.format === "database") {
    const { Database } = await import("bun:sqlite")
    using database = new Database(source, { readonly: true, strict: true })
    database.query("VACUUM INTO ?").run(output)
  }
  const { Database } = await import("@opencode/core/database/database")
  const { V1Migration } = await import("@opencode/core/database/v1-migration")
  const { Bus } = await import("@opencode/core/bus")
  const { SessionProjector } = await import("@opencode/core/session/projector")
  const { RedcodePending } = await import("@opencode/core/session/redcode-pending")
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* Database.Service
        if (inspection.format === "redcode") yield* V1Migration.importRedcode(source)
        if (inspection.format === "database")
          yield* V1Migration.run({ nextDatabasePath: path.join(path.dirname(output), "unselected-history.db") })
        yield* RedcodePending.admit()
        yield* database.db.run("PRAGMA wal_checkpoint(TRUNCATE)")
      }).pipe(
        Effect.provide(
          LayerNode.compile(LayerNode.group([Global.node, Database.node, Bus.node, SessionProjector.node]), {
            replacements: [
              Global.node.replace(Layer.succeed(Global.Service, Global.make({ data: path.dirname(output) }))),
              Database.node.replace(
                Database.importLayer({ path: output }).pipe(
                  Layer.provide(Layer.succeed(Global.Service, Global.make({ data: path.dirname(output) }))),
                ),
              ),
              Bus.node.replace(Bus.configured({ persist: true })),
            ],
          }),
        ),
      ),
    ).pipe(Effect.provide(Logger.layer([]))),
  )
}
