import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Global } from "@reddb-io/redcode-core/global"
import { Logging } from "@reddb-io/redcode-core/observability/logging"
import { launch, openLog, openerCommand } from "../../src/cli/cmd/debug/logs"

test("diagnostic discovery preserves the canonical global log path", () => {
  expect(Logging.filePath()).toBe(path.join(Global.Path.log, "redcode.log"))
})

test("open log passes a literal path to the opener and creates the file privately", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-open-log-"))
  await using _ = { [Symbol.asyncDispose]: () => fs.rm(dir, { recursive: true, force: true }) }
  const file = path.join(dir, "space ; $(not-a-command).log")
  const seen: string[] = []
  await openLog(file, async (target) => {
    seen.push(target)
    expect(await Bun.file(target).exists()).toBe(true)
  })
  expect(seen).toEqual([file])
  if (process.platform !== "win32") expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
})

test("an opener failure is reported, not swallowed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-open-log-"))
  await using _ = { [Symbol.asyncDispose]: () => fs.rm(dir, { recursive: true, force: true }) }
  await expect(
    openLog(path.join(dir, "redcode.log"), async () => {
      throw new Error("No file handler available")
    }),
  ).rejects.toThrow("No file handler available")
})

test("native openers do not interpolate the path in a shell", () => {
  const file = '/home/a b/$(nope); quote".log'
  expect(openerCommand(file, "linux").args).toEqual([file])
  expect(openerCommand(file, "darwin").args).toEqual([file])
  const windows = openerCommand(file, "win32")
  expect(windows.args.join(" ")).not.toContain(file)
  expect(windows.env.REDCODE_LOG_FILE).toBe(file)
  expect(windows.args.join(" ")).not.toContain("-Wait")
})

test("launcher reports a missing executable and immediate failure", async () => {
  await expect(launch("unused", { command: "redcode-no-such-log-opener", args: [], env: process.env })).rejects.toThrow()
  await expect(
    launch("unused", {
      command: process.execPath,
      args: ["-e", "process.exit(7)"],
      env: process.env,
    }, 3000),
  ).rejects.toThrow("Log file handler failed (7)")
})

test("launch acknowledgment does not wait for or kill a long-lived editor", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-launch-log-"))
  await using _ = { [Symbol.asyncDispose]: () => fs.rm(dir, { recursive: true, force: true }) }
  const marker = path.join(dir, "editor-finished")
  const script = `setTimeout(async () => { await Bun.write(${JSON.stringify(marker)}, "survived"); process.exit(0) }, 500)`
  await launch("unused", { command: process.execPath, args: ["-e", script], env: process.env }, 10)
  expect(await Bun.file(marker).exists()).toBe(false)
  const deadline = Date.now() + 5000
  while (!(await Bun.file(marker).exists()) && Date.now() < deadline) await Bun.sleep(20)
  expect(await Bun.file(marker).text()).toBe("survived")
})
