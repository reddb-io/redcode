import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { database, runtime } from "../src/system-info"

describe("system info", () => {
  test("names a remote database by its protocol and host, never its path or token", async () => {
    expect(await database({ url: "reds://db.example.com:5050/private/path" })).toEqual({
      kind: "remote",
      protocol: "reds",
      host: "db.example.com:5050",
    })
  })

  test("sizes a local database from its file and its write-ahead log", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-system-info-"))
    try {
      const file = path.join(directory, "opencode.db")
      await Bun.write(file, "x".repeat(1000))
      await Bun.write(`${file}-wal`, "y".repeat(30))
      expect(await database({ path: file })).toEqual({ kind: "local", path: file, size: 1000, wal: 30 })
      await fs.rm(`${file}-wal`)
      expect(await database({ path: file })).toEqual({ kind: "local", path: file, size: 1000 })
      expect(await database({ path: path.join(directory, "missing.db") })).toEqual({
        kind: "local",
        path: path.join(directory, "missing.db"),
      })
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test("is in memory without a path, or with the in-memory path", async () => {
    expect(await database(undefined)).toEqual({ kind: "memory" })
    expect(await database({})).toEqual({ kind: "memory" })
    expect(await database({ path: ":memory:" })).toEqual({ kind: "memory" })
  })

  test("names the runtime and its version", () => {
    expect(runtime()).toMatch(/^(bun|node) \S+$/)
  })
})
