import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { cleanupLogRuns, diagnosticLogRoots } from "./log-retention"

async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-desktop-logs-"))
  return { path: dir, [Symbol.asyncDispose]: () => fs.rm(dir, { recursive: true, force: true }) }
}

test("desktop retention bounds run count and bytes without deleting the active run", async () => {
  await using tmp = await directory()
  const now = Date.now()
  for (let index = 0; index < 7; index++) {
    const run = path.join(tmp.path, `20260922T12000${index}`)
    await fs.mkdir(run)
    await fs.writeFile(path.join(run, "main.log"), "x".repeat(40))
    await fs.utimes(run, new Date(now + index), new Date(now + index))
  }
  const active = path.join(tmp.path, "20260922T120000")
  const result = cleanupLogRuns(tmp.path, active, { maxRuns: 5, maxBytes: 120, now })
  expect(result.retained).toBe(3)
  expect(result.bytes).toBe(120)
  expect(result.removed).toHaveLength(4)
  expect(await Bun.file(path.join(active, "main.log")).exists()).toBe(true)
  expect((await fs.readdir(tmp.path)).sort()).toEqual(["20260922T120000", "20260922T120005", "20260922T120006"])
})

test("retention only removes owned run directories, never unrelated files or symlink targets", async () => {
  await using tmp = await directory()
  const outside = path.join(tmp.path, "preserve")
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, "notes"), "keep")
  const run = path.join(tmp.path, "20260922T120000")
  await fs.mkdir(run)
  await fs.utimes(run, new Date(0), new Date(0))
  if (process.platform !== "win32") await fs.symlink(outside, path.join(tmp.path, "20260922T120001"))
  const result = cleanupLogRuns(tmp.path, path.join(tmp.path, "active"))
  expect(result.removed).toEqual([run])
  expect(await Bun.file(path.join(outside, "notes")).text()).toBe("keep")
})

test("debug exports include canonical logs without dropping legacy paths", () => {
  expect(diagnosticLogRoots("/home/person", "/desktop", "/xdg")).toEqual([
    path.join("/home/person", ".red", "code", "data", "log"),
    path.join("/home/person", ".red", "redcode", "data", "log"),
    path.join("/xdg", "opencode", "log"),
    path.join("/desktop", "opencode", "log"),
  ])
})
