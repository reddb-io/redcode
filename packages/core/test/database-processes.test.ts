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

/**
 * Drains a stream to its end from the start, so a child that logs more than the pipe holds never
 * blocks on a full buffer, and resolves `seen` the moment `marker` has gone by.
 */
const drain = (stream: ReadableStream<Uint8Array>, marker: string) => {
  let seen!: () => void
  const ready = new Promise<void>((resolve) => {
    seen = resolve
  })
  const text = (async () => {
    const decoder = new TextDecoder()
    let all = ""
    for await (const chunk of stream) {
      all += decoder.decode(chunk, { stream: true })
      if (all.includes(marker)) seen()
    }
    seen()
    return all
  })()
  return { ready, text }
}

/** Starts the processes, releases them together once every one is loaded, and collects their exits. */
const race = async (dir: string, args: string[][]) => {
  const gate = path.join(dir, "go")
  const children = args.map((extra) =>
    Bun.spawn([process.execPath, script, ...extra], { stdout: "pipe", stderr: "pipe", env: process.env }),
  )
  try {
    // Both pipes are read from the start, together: a child blocked on a full stderr pipe would
    // otherwise never print "ready" and the test would sit until its timeout.
    const outputs = children.map((child) => ({
      stdout: drain(child.stdout, "ready"),
      stderr: drain(child.stderr, ""),
    }))
    await Promise.all(outputs.map((output) => output.stdout.ready))
    await fs.writeFile(gate, "")
    return await Promise.all(
      outputs.map(async (output, index) => ({
        code: await children[index]!.exited,
        stdout: await output.stdout.text,
        stderr: await output.stderr.text,
      })),
    )
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill()
  }
}

describe("one database across processes", () => {
  test("four processes opening an empty file at the same moment all migrate it once", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "shared.sqlite")
    const gate = path.join(tmp.path, "go")

    const results = await race(
      tmp.path,
      Array.from({ length: 4 }, () => ["open", filename, gate]),
    )

    expect(
      results.map((result) => result.code),
      results.map((result) => result.stderr).join("\n"),
    ).toEqual([0, 0, 0, 0])
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

  // The scenario from #58: parallel headless agents writing their sessions into one file. One
  // process keeps the write lock past the busy timeout twice, as a large write on a slow disk
  // would; the writers' own statements and transactions must wait it out instead of failing.
  test("several processes writing sessions at once all finish, even past a long lock hold", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "shared.sqlite")
    const gate = path.join(tmp.path, "go")
    const writers = ["a", "b", "c"]

    const results = await race(tmp.path, [
      ...writers.map((writer) => ["write", filename, gate, writer, "4000"]),
      ["hold", filename, gate, "holder", "1500"],
    ])

    expect(
      results.map((result) => result.code),
      results.map((result) => result.stderr).join("\n"),
    ).toEqual([0, 0, 0, 0])
    const wrote = results.map((result) => Number(/wrote (\d+)/.exec(result.stdout)?.[1]))
    for (const count of wrote.slice(0, writers.length)) expect(count).toBeGreaterThan(0)
    const file = new SqliteFile(filename, { readonly: true })
    try {
      const counts = (table: string) =>
        file
          .query<
            { session_id: string; count: number },
            []
          >(`SELECT session_id, count(*) AS count FROM ${table} GROUP BY session_id ORDER BY session_id`)
          .all()
      // Every write a process reported is there, once.
      expect(counts("message")).toEqual(
        [...writers, "holder"].map((writer, index) => ({ session_id: `ses_${writer}`, count: wrote[index]! })),
      )
      expect(counts("part")).toEqual(
        writers.map((writer, index) => ({ session_id: `ses_${writer}`, count: wrote[index]! })),
      )
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
