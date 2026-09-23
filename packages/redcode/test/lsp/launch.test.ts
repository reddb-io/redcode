import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import { spawn } from "../../src/lsp/launch"
import { tmpdir } from "../fixture/fixture"

describe("lsp.launch", () => {
  test("spawns cmd scripts with spaces on Windows", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "with space")
    const file = path.join(dir, "echo cmd.cmd")

    await fs.mkdir(dir, { recursive: true })
    await Bun.write(file, "@echo off\r\nif %~1==--stdio exit /b 0\r\nexit /b 7\r\n")

    const proc = spawn(file, ["--stdio"])

    expect(await proc.exited).toBe(0)
  })

  // A server that exits at startup (a NODE_OPTIONS flag its Node rejects) closes its
  // stdin before the client's first write. The resulting EPIPE must not escape as an
  // unhandled error: the exit is what recover() acts on. The child here closes stdin
  // but stays alive, which makes the EPIPE deterministic on every platform.
  test("a write to a server that closed its stdin does not raise", async () => {
    const proc = spawn(process.execPath, [
      "-e",
      "require('fs').closeSync(0); process.stdout.write('closed'); setTimeout(() => {}, 5000)",
    ])
    try {
      // Driven by events, not delays: write once the child reports stdin closed, then
      // wait for the write side to close after the failed write.
      await new Promise((resolve) => proc.stdout.once("data", resolve))
      const closed = new Promise((resolve) => proc.stdin.once("close", resolve))
      for (let i = 0; i < 5; i++) proc.stdin.write("x".repeat(70_000))
      await closed
      expect(proc.stdin.destroyed).toBe(true)
    } finally {
      proc.kill()
    }
  })

  // vscode-jsonrpc's sendRequest rejects its promise when the write fails, then rethrows the
  // write error from an async Promise executor, where no one can catch it. A server that exits
  // at startup turned that into an unhandled EPIPE on Windows (node-options-recovery.test.ts).
  // Writing after the child exited fails the write on every platform.
  test("a request to a server that already exited rejects without an unhandled rejection", async () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", record)
    const proc = spawn(process.execPath, ["-e", "process.exit(0)"])
    try {
      await proc.exited
      const connection = createMessageConnection(
        new StreamMessageReader(proc.stdout),
        new StreamMessageWriter(proc.stdin),
      )
      connection.listen()
      const outcome = await connection.sendRequest("initialize", {}).then(
        () => "resolved",
        () => "rejected",
      )
      connection.dispose()
      // Bun reports unhandled rejections from the check phase, not from a timer.
      await new Promise((resolve) => setImmediate(resolve))
      expect(outcome).toBe("rejected")
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", record)
    }
  })
})
