import { describe, expect, test } from "bun:test"
import type { SystemInfo } from "@opencode/client"
import { formatBytes, formatUptime, systemLines } from "../src/routes/session/composer/system-model"

const info = (database: SystemInfo["database"], extra: Partial<SystemInfo> = {}): SystemInfo => ({
  version: "0.66.0",
  runtime: "bun 1.4.2",
  platform: "linux x64",
  pid: 4242,
  started: 1_000,
  memory: 150 * 1024 * 1024,
  urls: ["http://127.0.0.1:4096"],
  paths: {
    config: "/home/u/.config/redcode",
    data: "/home/u/.local/share/redcode",
    state: "/home/u/.local/state/redcode",
    cache: "/home/u/.cache/redcode",
    log: "/home/u/.local/share/redcode/log",
    tmp: "/tmp/redcode",
  },
  database,
  ...extra,
})
const value = (lines: ReturnType<typeof systemLines>, label: string) =>
  lines.flatMap((line) => ("label" in line && line.label === label ? [line.value] : []))[0]

describe("System tab formatting", () => {
  test("formats sizes in powers of 1024", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB")
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB")
    expect(formatBytes(-1)).toBe("unknown")
    expect(formatBytes(Number.NaN)).toBe("unknown")
  })

  test("formats uptime in its two largest units", () => {
    expect(formatUptime(5_000)).toBe("5s")
    expect(formatUptime(125_000)).toBe("2m 5s")
    expect(formatUptime(3 * 3_600_000 + 20 * 60_000)).toBe("3h 20m")
    expect(formatUptime(2 * 86_400_000 + 5 * 3_600_000)).toBe("2d 5h")
    expect(formatUptime(-10)).toBe("0s")
  })
})

describe("systemLines", () => {
  test("describes a local database with its file, its log and its rows", () => {
    const lines = systemLines(
      info(
        { kind: "local", path: "/data/opencode.db", size: 5 * 1024 * 1024, wal: 2048 },
        { counts: { sessions: 12, messages: 340 } },
      ),
      61_000,
    )
    expect(value(lines, "version")).toBe("0.66.0")
    expect(value(lines, "runtime")).toBe("bun 1.4.2 · linux x64")
    expect(value(lines, "process")).toBe("pid 4242 · up 1m 0s · 150 MB")
    expect(value(lines, "type")).toBe("local (SQLite)")
    expect(value(lines, "path")).toBe("/data/opencode.db")
    expect(value(lines, "size")).toBe("5.0 MB + 2.0 KB log")
    expect(value(lines, "rows")).toBe("12 sessions · 340 messages")
    expect(value(lines, "logs")).toBe("/home/u/.local/share/redcode/log")
  })

  test("describes a remote database by its host and protocol only", () => {
    const lines = systemLines(info({ kind: "remote", protocol: "reds", host: "db.example.com:5050" }), 2_000)
    expect(value(lines, "type")).toBe("remote (reds)")
    expect(value(lines, "host")).toBe("db.example.com:5050")
    expect(value(lines, "path")).toBeUndefined()
    expect(value(lines, "rows")).toBeUndefined()
  })

  test("says when the database is in memory or its size is unknown", () => {
    expect(value(systemLines(info({ kind: "memory" }), 0), "type")).toBe("in memory, not saved")
    expect(value(systemLines(info({ kind: "local", path: "/data/x.db" }), 0), "size")).toBe("unknown")
  })

  test("lists at most three URLs and groups the lines under headings", () => {
    const lines = systemLines(info({ kind: "memory" }, { urls: ["http://a", "http://b", "http://c", "http://d"] }), 0)
    expect(lines.filter((line) => "label" in line && line.label === "url")).toHaveLength(3)
    expect(lines.flatMap((line) => ("heading" in line ? [line.heading] : []))).toEqual(["Redcode", "Database", "Files"])
  })
})
