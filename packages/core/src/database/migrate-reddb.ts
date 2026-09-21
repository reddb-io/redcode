import { connect, type QueryParam, type RedDB, type RedDBTransaction } from "@reddb-io/client"
import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Database } from "bun:sqlite"
import { Global } from "../global"
import { normalizeSQL, rowsFromResult } from "./reddb"

interface Table {
  readonly name: string
  readonly sql: string
  readonly columns: string[]
  readonly order: string[]
  readonly dependencies: string[]
}

export interface MigrationResult {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly manifest: string
  readonly tables: ReadonlyArray<{ name: string; rows: number; hash: string; resumed: boolean }>
}

export async function migrateToRedDB(source: string, target: string, token?: string): Promise<MigrationResult> {
  const id = randomUUID()
  const sqlite = new Database(source, { readonly: true, create: false })
  const database = await connect(target, token ? { auth: { token } } : undefined)
  try {
    const tables = orderedTables(sqlite)
    await database.query(`
      CREATE TABLE IF NOT EXISTS redcode_migration_manifest (
        table_name TEXT PRIMARY KEY,
        row_count INTEGER NOT NULL,
        source_hash TEXT NOT NULL,
        target_hash TEXT NOT NULL,
        time_completed INTEGER NOT NULL
      )
    `)
    const existing = new Map(
      rowsFromResult(
        await database.query("SELECT table_name, row_count, source_hash, target_hash FROM redcode_migration_manifest"),
      ).map((row) => [String(row.table_name), row]),
    )
    const results: Array<{ name: string; rows: number; hash: string; resumed: boolean }> = []
    for (const table of tables) {
      const sourceRows = rows(sqlite, table)
      const sourceHash = hashRows(sourceRows)
      const completed = existing.get(table.name)
      if (
        completed &&
        Number(completed.row_count) === sourceRows.length &&
        completed.source_hash === sourceHash &&
        completed.target_hash === sourceHash
      ) {
        const targetRows = await readTarget(database, table).catch(() => [])
        if (targetRows.length !== sourceRows.length || hashRows(targetRows) !== sourceHash)
          throw new Error(`Target table ${table.name} changed after it was verified`)
        results.push({ name: table.name, rows: sourceRows.length, hash: sourceHash, resumed: true })
        continue
      }
      if (completed)
        throw new Error(`Source table ${table.name} changed after it was copied; start a new migration target`)
      const present = await readTarget(database, table).then(
        (rows) => ({ exists: true, rows }),
        () => ({ exists: false, rows: [] as Record<string, QueryParam>[] }),
      )
      const before = present.rows
      if (before.length > 0 && (before.length !== sourceRows.length || hashRows(before) !== sourceHash))
        throw new Error(`Target table ${table.name} contains data not recorded by this migration`)
      if (before.length === 0)
        await database.transaction(async (tx) => {
          if (!present.exists) await tx.query(normalizeSQL(table.sql))
          await insertRows(tx, table, sourceRows)
        })
      const targetRows = await readTarget(database, table)
      const targetHash = hashRows(targetRows)
      if (targetRows.length !== sourceRows.length || targetHash !== sourceHash)
        throw new Error(`Verification failed for ${table.name}: source and target differ`)
      await database.query(
        `INSERT INTO redcode_migration_manifest
          (table_name, row_count, source_hash, target_hash, time_completed)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (table_name) DO UPDATE SET
          row_count = excluded.row_count,
          source_hash = excluded.source_hash,
          target_hash = excluded.target_hash,
          time_completed = excluded.time_completed`,
        table.name,
        sourceRows.length,
        sourceHash,
        targetHash,
        Date.now(),
      )
      results.push({ name: table.name, rows: sourceRows.length, hash: sourceHash, resumed: false })
    }
    for (const statement of sqlite
      .query<
        { sql: string },
        []
      >("SELECT sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name")
      .all())
      await database.query(normalizeSQL(statement.sql)).catch((error) => {
        if (!/already exists/i.test(error instanceof Error ? error.message : String(error))) throw error
      })
    const manifest = path.join(Global.Path.data, "database-migrations", `${id}.json`)
    await fs.mkdir(path.dirname(manifest), { recursive: true, mode: 0o700 })
    await fs.writeFile(
      manifest,
      JSON.stringify({ id, source, target, completed: Date.now(), tables: results }, null, 2),
      { mode: 0o600 },
    )
    return { id, source, target, manifest, tables: results }
  } finally {
    sqlite.close()
    await database.close()
  }
}

function orderedTables(database: Database) {
  const tables = database
    .query<{ name: string; sql: string }, []>(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .filter((table) => table.name !== "redcode_migration_manifest")
    .map((table): Table => {
      const columns = database
        .query<{ name: string; pk: number }, []>(`PRAGMA table_info(${identifier(table.name)})`)
        .all()
      return {
        ...table,
        columns: columns.map((column) => column.name),
        order: columns
          .filter((column) => column.pk > 0)
          .toSorted((a, b) => a.pk - b.pk)
          .map((column) => column.name),
        dependencies: database
          .query<{ table: string }, []>(`PRAGMA foreign_key_list(${identifier(table.name)})`)
          .all()
          .map((foreign) => foreign.table),
      }
    })
  const pending = new Map(tables.map((table) => [table.name, table]))
  const ordered: Table[] = []
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((table) => table.dependencies.every((name) => !pending.has(name)))
    const next = ready.length > 0 ? ready : [[...pending.values()][0]!]
    next.forEach((table) => {
      pending.delete(table.name)
      ordered.push(table)
    })
  }
  return ordered
}

function rows(database: Database, table: Table) {
  const order = table.order.length > 0 ? table.order : table.columns
  return database
    .query<
      Record<string, QueryParam>,
      []
    >(`SELECT * FROM ${identifier(table.name)}${order.length ? ` ORDER BY ${order.map(identifier).join(", ")}` : ""}`)
    .all()
}

async function readTarget(database: RedDB, table: Table) {
  const order = table.order.length > 0 ? table.order : table.columns
  return rowsFromResult(
    await database.query(
      `SELECT ${table.columns.map(identifier).join(", ")} FROM ${identifier(table.name)}${
        order.length ? ` ORDER BY ${order.map(identifier).join(", ")}` : ""
      }`,
    ),
  ).map((row) => Object.fromEntries(table.columns.map((column) => [column, row[column] ?? null]))) as Record<
    string,
    QueryParam
  >[]
}

async function insertRows(tx: RedDBTransaction, table: Table, input: Record<string, QueryParam>[]) {
  for (const row of input) {
    await tx.query(
      `INSERT INTO ${identifier(table.name)} (${table.columns.map(identifier).join(", ")}) VALUES (${table.columns
        .map((_, index) => `$${index + 1}`)
        .join(", ")})`,
      table.columns.map((column) => row[column] ?? null),
    )
  }
}

function hashRows(input: Record<string, QueryParam>[]) {
  const hash = createHash("sha256")
  input.forEach((row) =>
    hash.update(
      JSON.stringify(row, (_, value) =>
        value instanceof Uint8Array ? { type: "bytes", base64: Buffer.from(value).toString("base64") } : value,
      ),
    ),
  )
  return hash.digest("hex")
}

function identifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}
