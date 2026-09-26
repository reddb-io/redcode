import { connect } from "@reddb-io/client"
import { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"
import { link, mkdir, open, rm } from "node:fs/promises"
import path from "node:path"

const TABLES = [
  "project",
  "session",
  "session_message",
  "message",
  "part",
  "account",
  "account_state",
  "credential",
  "project_directory",
  "permission",
  "session_input",
  "session_context_epoch",
  "session_monitor",
  "session_goal",
  "session_goal_review",
  "session_plan",
  "todo",
  "todo_history",
  "session_guard_trip",
  "session_share",
  "design_document",
  "design_revision",
  "design_feedback",
  "design_asset",
  "design_render_job",
  "intelligence_evaluation",
  "intelligence_answer",
] as const

const REQUIRED = new Set(["project", "session", "session_message", "message", "part"])

export async function exportRedcode(source: string, target: string, token?: string) {
  const database = await connect(source, token ? { auth: { token } } : undefined)
  try {
    if (!(await database.exists("session")) || (await database.exists("session_v2")))
      throw new Error("RedDB source must contain V1 sessions and no V2 session table")
    const available = new Set((await database.list()).map((table) => table.name))
    const missing = [...REQUIRED].filter((table) => !available.has(table))
    if (missing.length) throw new Error(`RedDB source is missing V1 tables: ${missing.join(", ")}`)
    await mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    const file = await open(temporary, "wx", 0o600)
    await file.close()
    const sqlite = new Database(temporary, { create: false })
    const tables: Array<{ name: string; rows: number }> = []
    try {
      try {
        sqlite.run("BEGIN")
        await database.transaction(async (transaction) => {
          for (const name of TABLES.filter((table) => available.has(table))) {
            const result = await transaction.query(`SELECT * FROM ${identifier(name)}`)
            const columns = result.columns.length ? result.columns : Object.keys(result.rows[0] ?? {})
            if (!columns.length) {
              if (REQUIRED.has(name)) throw new Error(`RedDB did not report the columns for ${name}`)
              continue
            }
            sqlite.run(
              `CREATE TABLE ${identifier(name)} (${columns.map((column) => `${identifier(column)} BLOB`).join(", ")})`,
            )
            const insert = sqlite.prepare(
              `INSERT INTO ${identifier(name)} (${columns.map(identifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
            )
            result.rows.forEach((row) => insert.run(...columns.map((column) => binding(row[column]))))
            const copied = sqlite.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${identifier(name)}`).get()?.count
            if (copied !== result.rows.length) throw new Error(`SQLite snapshot row count differs for ${name}`)
            tables.push({ name, rows: result.rows.length })
          }
        })
        sqlite.run("COMMIT")
      } finally {
        sqlite.close()
      }
      await link(temporary, target)
      return { source, target, tables }
    } finally {
      await rm(temporary, { force: true })
    }
  } finally {
    await database.close()
  }
}

function identifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function binding(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean")
    return value
  if (value instanceof Uint8Array) return value
  if (value instanceof Date) return value.toISOString()
  return JSON.stringify(value) ?? String(value)
}
