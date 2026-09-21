import { afterEach, expect, test } from "bun:test"
import { Database } from "../src/database/database"
import { bindParameters, normalizeSQL } from "../src/database/reddb"

const originalURL = process.env.REDCODE_DATABASE_URL

afterEach(() => {
  if (originalURL === undefined) delete process.env.REDCODE_DATABASE_URL
  else process.env.REDCODE_DATABASE_URL = originalURL
})

test("RedDB SQL removes unsupported foreign keys and normalizes transactions", () => {
  expect(normalizeSQL("BEGIN DEFERRED")).toBe("BEGIN")
  expect(normalizeSQL("SELECT `value` FROM `items`")).toBe('SELECT "value" FROM "items"')
  expect(normalizeSQL("CREATE TABLE item (`id` TEXT, `name` TEXT DEFAULT '' NOT NULL)")).toBe(
    `CREATE TABLE IF NOT EXISTS item ("id" TEXT, "name" TEXT DEFAULT = '' NOT NULL)`,
  )
  expect(
    normalizeSQL("CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE)"),
  ).toBe("CREATE TABLE IF NOT EXISTS child (id TEXT PRIMARY KEY, parent_id TEXT)")
  expect(normalizeSQL("CREATE TABLE item (`a` TEXT, `b` TEXT, CONSTRAINT `item_pk` PRIMARY KEY(`a`, `b`))")).toBe(
    'CREATE TABLE IF NOT EXISTS item ("a" TEXT, "b" TEXT, CONSTRAINT "item_pk" UNIQUE("a", "b"))',
  )
  expect(
    normalizeSQL(`CREATE TABLE child (
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      CONSTRAINT child_parent FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE
    );`),
  ).toBe(`CREATE TABLE IF NOT EXISTS child (
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL
)`)
})

test("RedDB placeholders preserve question marks in quoted SQL", () => {
  expect(bindParameters("SELECT ?, '?', \"?\", `?`, 'it''s ?' WHERE id = ?", 2)).toBe(
    "SELECT $1, '?', \"?\", `?`, 'it''s ?' WHERE id = $2",
  )
})

test("REDCODE_DATABASE_URL selects RedDB without falling back to SQLite", async () => {
  process.env.REDCODE_DATABASE_URL = "red://database.example:5050/redcode"
  expect(await Database.selection()).toEqual({
    backend: "reddb",
    location: "red://database.example:5050/redcode",
    source: "environment",
  })

  process.env.REDCODE_DATABASE_URL = "file:///tmp/redcode.db"
  expect(Database.selection()).rejects.toThrow("Unsupported REDCODE_DATABASE_URL protocol")
})

test("RedDB URLs reject embedded credentials, query parameters and fragments", () => {
  expect(() => Database.validateURL("https://user:secret@database.example/redcode")).toThrow(
    "must not contain credentials",
  )
  expect(() => Database.validateURL("https://database.example/redcode?token=secret")).toThrow(
    "must not contain credentials",
  )
  expect(() => Database.validateURL("https://database.example/redcode#primary")).toThrow("must not contain credentials")
})
