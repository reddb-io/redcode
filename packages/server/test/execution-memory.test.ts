import { describe, expect, test } from "bun:test"
import { processRows, treeMemory } from "../src/execution-memory"
import { spawn } from "node:child_process"
import { Database } from "bun:sqlite"
import { createHarnessTasks } from "../src/harness-tasks"

describe("execution memory", () => {
  test("only attributes known descendants and includes each child once", () => {
    const rows = [
      { pid: 1, parent: 0, bytes: 10 },
      { pid: 2, parent: 1, bytes: 20 },
      { pid: 3, parent: 2, bytes: 30 },
      { pid: 4, parent: 2, bytes: 40 },
      { pid: 5, parent: 9, bytes: 50 },
    ]
    expect(treeMemory(rows, 2, 1)).toBe(90)
    expect(treeMemory(rows, 3, 2)).toBe(30)
    expect(treeMemory(rows, 5, 1)).toBeNull()
    expect(treeMemory(rows, 1, 1)).toBeNull()
    expect(treeMemory(rows, 5, null)).toBe(50)
    expect(treeMemory(rows, 99, null)).toBeNull()
  })
  test("reads this host's actual process counters", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 12000)"], { windowsHide: true })
    try {
      const rows = await processRows()
      expect(rows).toBeDefined()
      expect(rows!.find((row) => row.pid === process.pid)?.bytes).toBeGreaterThan(0)
      expect(treeMemory(rows!, child.pid!, process.pid)).toBeGreaterThan(0)
    } finally {
      child.kill()
    }
  }, 15_000)
  test("reads only bounded active harness task identities without copying output", () => {
    const db = new Database(":memory:")
    try {
      const tasks = createHarnessTasks(db)
      const insert = db.query("INSERT INTO native_task(run,id,data) VALUES (?,?,?)")
      for (let i = 0; i < 110; i++)
        insert.run(
          "run",
          String(i),
          JSON.stringify({ title: `task ${i}`, status: "running", processID: String(i + 1), output: "private" }),
        )
      insert.run("other", "not-owned", JSON.stringify({ title: "other", status: "running" }))
      const rows = tasks.memory("run")
      expect(rows).toHaveLength(100)
      expect(rows[0]).toEqual({ id: "109", title: "task 109", processID: "110" })
      expect(rows.some((row) => "output" in row)).toBe(false)
    } finally {
      db.close()
    }
  })
})
