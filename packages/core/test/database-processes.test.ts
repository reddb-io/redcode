import { describe, expect, test } from "bun:test"
import { Database as SqliteFile } from "bun:sqlite"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { migrations } from "@reddb-io/redcode-core/database/migration.gen"
import { tmpdir } from "./fixture/tmpdir"

// Real processes, as the user runs them: each has its own connection, its own busy handler and
// its own thread, so a lock wait in one never stalls the other the way two connections on one
// thread would.
const script = fileURLToPath(new URL("./fixture/database-process.ts", import.meta.url))

const readUntil = async (stream: ReadableStream<Uint8Array>, marker: string) => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  while (!text.includes(marker)) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  reader.releaseLock()
  return text
}

/** Starts the processes, releases them together once every one is loaded, and collects their exits. */
const race = async (dir: string, args: string[][]) => {
  const gate = path.join(dir, "go")
  const children = args.map((extra) =>
    Bun.spawn([process.execPath, script, ...extra], { stdout: "pipe", stderr: "pipe", env: process.env }),
  )
  await Promise.all(children.map((child) => readUntil(child.stdout, "ready")))
  await fs.writeFile(gate, "")
  return Promise.all(
    children.map(async (child) => ({ code: await child.exited, stderr: await new Response(child.stderr).text() })),
  )
}

describe("one database across processes", () => {
  test("two processes opening an empty file at the same moment both migrate it once", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "shared.sqlite")
    const gate = path.join(tmp.path, "go")

    const results = await race(tmp.path, [
      ["open", filename, gate],
      ["open", filename, gate],
    ])

    expect(
      results.map((result) => result.code),
      results.map((result) => result.stderr).join("\n"),
    ).toEqual([0, 0])
    const file = new SqliteFile(filename, { readonly: true })
    try {
      expect(file.query("SELECT count(*) AS count FROM migration").get()).toEqual({ count: migrations.length })
      expect(file.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'").get()).toEqual({
        name: "session",
      })
    } finally {
      file.close()
    }
  }, 60_000)

  test("two processes appending to one aggregate never share or skip a sequence", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "shared.sqlite")
    const gate = path.join(tmp.path, "go")
    const count = 40

    const results = await race(tmp.path, [
      ["append", filename, gate, "a", String(count)],
      ["append", filename, gate, "b", String(count)],
    ])

    expect(
      results.map((result) => result.code),
      results.map((result) => result.stderr).join("\n"),
    ).toEqual([0, 0])
    const file = new SqliteFile(filename, { readonly: true })
    try {
      const rows = file
        .query<
          { seq: number; data: string },
          []
        >("SELECT seq, data FROM event WHERE aggregate_id = 'shared' ORDER BY seq")
        .all()
      expect(rows.map((row) => row.seq)).toEqual(Array.from({ length: count * 2 }, (_, index) => index))
      // Every append landed exactly once, in each writer's own order.
      for (const writer of ["a", "b"]) {
        const own = rows.map((row) => JSON.parse(row.data)).filter((data) => data.writer === writer)
        expect(own.map((data) => data.n)).toEqual(Array.from({ length: count }, (_, index) => index))
      }
      expect(file.query("SELECT seq FROM event_sequence WHERE aggregate_id = 'shared'").get()).toEqual({
        seq: count * 2 - 1,
      })
    } finally {
      file.close()
    }
  }, 60_000)
})
