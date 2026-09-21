import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@reddb-io/redcode-core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"

const QueryCommand = effectCmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: Effect.fn("Cli.db.query")(function* (args: { query?: string; format: string }) {
    const query = args.query
    if (query) {
      const { db } = yield* Database.Service
      const result = yield* db.all<Record<string, unknown>>(sql.raw(query)).pipe(Effect.orDie)
      if (args.format === "json") console.log(JSON.stringify(result, null, 2))
      else if (result.length > 0) {
        const keys = Object.keys(result[0])
        console.log(keys.join("\t"))
        for (const row of result) console.log(keys.map((key) => row[key]).join("\t"))
      }
      return
    }
    const selected = yield* Effect.promise(Database.selection)
    if (selected.backend !== "sqlite") {
      console.log("Interactive database shells are available only for SQLite; pass a SQL query to query RedDB.")
      return
    }
    const child = spawn("sqlite3", [Database.path()], {
      stdio: "inherit",
    })
    yield* Effect.promise(() => new Promise((resolve) => child.on("close", resolve)))
  }),
})

const StatusCommand = effectCmd({
  command: "status",
  describe: "show the selected database backend and verify connectivity",
  instance: false,
  handler: Effect.fn("Cli.db.status")(function* () {
    const selected = yield* Effect.promise(Database.selection)
    const { db } = yield* Database.Service
    yield* db.all(sql`SELECT 1 AS ok`).pipe(Effect.orDie)
    console.log(
      JSON.stringify(
        { backend: selected.backend, location: selected.location, source: selected.source, connected: true },
        null,
        2,
      ),
    )
  }),
})

const MigrateCommand = effectCmd({
  command: "migrate",
  describe: "copy the current SQLite database to RedDB and verify every table",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("to", {
      type: "string",
      demandOption: true,
      describe: "RedDB URL",
    }),
  handler: Effect.fn("Cli.db.migrate")(function* (args: { to: string }) {
    const source = yield* Effect.promise(async () => {
      const selected = await Database.selection()
      if (selected.backend !== "sqlite")
        throw new Error("SQLite-to-RedDB migration requires SQLite to be the selected source backend")
      return selected.location
    })
    const { migrateToRedDB } = yield* Effect.promise(() => import("@reddb-io/redcode-core/database/migrate-reddb"))
    const result = yield* Effect.promise(() =>
      migrateToRedDB(source, Database.validateURL(args.to), process.env.REDCODE_DATABASE_TOKEN),
    )
    console.log(JSON.stringify(result, null, 2))
  }),
})

const PathCommand = effectCmd({
  command: "path",
  describe: "print the database path",
  instance: false,
  handler: Effect.fn("Cli.db.path")(function* () {
    console.log((yield* Effect.promise(Database.selection)).location)
  }),
})

export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .command(QueryCommand)
      .command(PathCommand)
      .command(StatusCommand)
      .command(MigrateCommand)
      .demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
