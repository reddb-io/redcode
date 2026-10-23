import { describe, expect, test } from "bun:test"
import { ClientError, type SessionStatsInfo } from "@opencode/client"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { renderStats, request } from "../src/commands/handlers/stats"
import { OPENCODE_VERSION } from "../src/version"

const tools = {
  mode: "detail",
  totals: { calls: 10, succeeded: 8, failed: 2, unfinished: 0 },
  usage: [{ name: "private_tool", calls: 10, succeeded: 8, failed: 2, unfinished: 0, durationP50: 250 }],
} satisfies SessionStatsInfo["tools"]

const stats: SessionStatsInfo = {
  range: { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 0, 8) },
  sessions: 2,
  subagents: 1,
  prompts: 4,
  steps: 6,
  tokens: { input: 10_000, output: 2_000, reasoning: 1_000, cache: { read: 5_000, write: 500 } },
  cost: 12.34,
  tools,
  activeDays: 2,
  streak: 2,
  activity: [
    { date: "2026-01-02", steps: 2 },
    { date: "2026-01-03", steps: 4 },
  ],
  models: [
    {
      model: { providerID: "anthropic", id: "sonnet" },
      steps: 6,
      tokens: { input: 10_000, output: 2_000, reasoning: 1_000, cache: { read: 5_000, write: 500 } },
      cost: 12.34,
    },
  ],
}

describe("stats rendering", () => {
  test("keeps the default card shareable", () => {
    const output = renderStats(stats, options())
    expect(output).toContain("redcode stats · 2026 so far · all projects")
    expect(output).toContain("activity")
    expect(output).toMatch(/Mo .*(?:\r?\n){2}Tu/)
    expect(output).toMatch(/Su .*(?:\r?\n){2}   less/)
    expect(output).toContain("less ·░▒▓█ more")
    expect(output).toContain("2 sessions · 1 subagent")
    expect(output).toContain("80.0% tool success · 2 active days · best streak 2 days")
    expect(output).not.toContain("private_tool")
    expect(output).not.toContain("$12.34")
  })

  test("renders shared intensity levels and partial month labels", () => {
    const output = renderStats(
      {
        ...stats,
        range: { from: new Date(2026, 3, 29).getTime(), to: new Date(2026, 4, 20).getTime() },
        activity: [{ date: "2026-04-29", steps: 1 }],
      },
      options(),
    )
    expect(output).toContain("    May")
    expect(output).not.toContain("Apr")
    expect(output.split(/\r?\n/).find((line) => line.startsWith("We "))).toContain("\u2588")
  })

  test("renders only requested detail tables", () => {
    const output = renderStats(stats, options({ tools: true, cost: true }))
    expect(output).toContain("COST & TOKENS")
    expect(output).toContain("TOOL RELIABILITY")
    expect(output).toContain("private_tool")
    expect(output).toContain("tool")
    expect(output).toContain("calls")
    expect(output).toContain("cached input        32.3%")
    expect(output).not.toContain("redcode stats")
    expect(output).not.toContain("activity")
  })

  test("shows when detail tables omit rows", () => {
    const output = renderStats(
      {
        ...stats,
        models: [
          ...stats.models,
          {
            model: { providerID: "anthropic", id: "haiku" },
            steps: 2,
            tokens: { input: 2_000, output: 500, reasoning: 0, cache: { read: 1_000, write: 0 } },
            cost: 1.25,
          },
        ],
        tools: {
          mode: "detail",
          totals: tools.totals,
          usage: [...tools.usage, { name: "grep", calls: 4, succeeded: 4, failed: 0, unfinished: 0, durationP50: 20 }],
        },
      },
      options({ models: true, tools: true, limit: 1 }),
    )
    expect(output).toContain("+1 more model")
    expect(output).toContain("+1 more tool")
  })

  test("uses the OpenCode palette in color mode", () => {
    const output = renderStats(stats, options({ color: true }))
    expect(output).toContain("\x1b[1;36m")
    expect(output).not.toContain("38;5;45")
  })

  test("uses compact layouts in narrow terminals", () => {
    const output = renderStats(stats, options({ models: true, width: 48 }))
    expect(output).toContain("anthropic/sonnet")
    expect(output).toContain("18.5k tokens · 6 steps · $12.34")
    expect(output.split(/\r?\n/).every((line) => line.length <= 48)).toBe(true)
  })

  test("shows a known subtotal and record coverage when some costs are unknown", () => {
    const output = renderStats(
      { ...stats, costCoverage: { reported: 1, estimated: 2, unknown: 3, legacy: 4 } },
      options({ cost: true }),
    )
    expect(output).toContain("known subtotal")
    expect(output).toContain("$12.34+")
    expect(output).toContain("reported records    1")
    expect(output).toContain("estimated records   2")
    expect(output).toContain("unknown records     3")
    expect(output).toContain("legacy records      4")
    expect(output).toContain("+ excludes unknown costs")
  })

  test("does not present an unresolved zero contribution as free usage", () => {
    const output = renderStats(
      {
        ...stats,
        cost: 0,
        costCoverage: { reported: 0, estimated: 0, unknown: 1, legacy: 0 },
        models: [{ ...stats.models[0], cost: 0, costCoverage: { reported: 0, estimated: 0, unknown: 1, legacy: 0 } }],
      },
      options({ cost: true, models: true }),
    )
    expect(output).toContain("unknown")
    expect(output).not.toContain("$0.00")
  })

  test("keeps provider-reported zero distinct from estimated and unclassified prices", () => {
    const reported = renderStats(
      { ...stats, cost: 0, costCoverage: { reported: 1, estimated: 0, unknown: 0, legacy: 0 } },
      options({ cost: true }),
    )
    expect(reported).toContain("$0.00")
    expect(reported).not.toContain("$0.00*")
    expect(reported).not.toContain("~$0.00")
    const estimated = renderStats(
      { ...stats, costCoverage: { reported: 1, estimated: 1, unknown: 0, legacy: 0 } },
      options({ cost: true }),
    )
    expect(estimated).toContain("~$12.34")
    expect(estimated).toContain("~ includes estimated costs")
    const legacy = renderStats(stats, options({ cost: true }))
    expect(legacy).toContain("$12.34*")
    expect(legacy).toContain("* cost provenance unavailable")
    expect(legacy).not.toContain("legacy records")
  })

  test.each([48, 80])("qualifies each model price independently at width %s", (width) => {
    const output = renderStats(
      {
        ...stats,
        models: [
          { ...stats.models[0], costCoverage: { reported: 1, estimated: 0, unknown: 0, legacy: 0 } },
          {
            ...stats.models[0],
            model: { providerID: "test", id: "estimated" },
            costCoverage: { reported: 0, estimated: 1, unknown: 0, legacy: 0 },
          },
          {
            ...stats.models[0],
            model: { providerID: "test", id: "partial" },
            costCoverage: { reported: 0, estimated: 0, unknown: 1, legacy: 0 },
          },
          { ...stats.models[0], model: { providerID: "test", id: "legacy" } },
        ],
      },
      options({ models: true, width }),
    )
    expect(output).toContain("~$12.34")
    expect(output).toContain("$12.34+")
    expect(output).toContain("$12.34*")
    expect(output).toContain("~ includes estimated costs")
    expect(output).toContain("+ excludes unknown costs")
    expect(output).toContain("* cost provenance unavailable")
    expect(output.split(/\r?\n/).every((line) => line.length <= width)).toBe(true)
  })

  test("keeps the shareable default free of monetary amounts and coverage notes", () => {
    const output = renderStats(
      { ...stats, costCoverage: { reported: 1, estimated: 2, unknown: 3, legacy: 4 } },
      options(),
    )
    expect(output).not.toContain("$12.34")
    expect(output).not.toContain("unknown costs")
    expect(output).not.toContain("legacy records")
  })

  test("does not attribute the global coverage or hidden models to a displayed model", () => {
    const output = renderStats(
      {
        ...stats,
        costCoverage: { reported: 1, estimated: 0, unknown: 1, legacy: 0 },
        models: [
          { ...stats.models[0], costCoverage: { reported: 1, estimated: 0, unknown: 0, legacy: 0 } },
          { ...stats.models[0], costCoverage: { reported: 0, estimated: 0, unknown: 1, legacy: 0 } },
        ],
      },
      options({ models: true, limit: 1 }),
    )
    expect(output).toContain("$12.34")
    expect(output).not.toContain("$12.34+")
    expect(output).not.toContain("excludes unknown costs")
    expect(output).toContain("+1 more model")
  })

  test("renders a concise empty state", () => {
    const output = renderStats(
      { ...stats, sessions: 0, subagents: 0, prompts: 0, steps: 0, activeDays: 0, streak: 0, activity: [] },
      options(),
    )
    expect(output).toContain("no activity in this range")
    expect(output).not.toContain("less ·░▒▓█ more")
  })

  test("does not present uncollected tools as zero calls", () => {
    const output = renderStats({ ...stats, tools: { mode: "none" } }, options())
    expect(output).toContain("tool stats unavailable")
    expect(output).not.toContain("no tool calls")
  })

  test("labels activity when terminal width truncates the requested range", () => {
    const output = renderStats(
      { ...stats, range: { from: Date.UTC(2020, 0, 1), to: Date.UTC(2026, 0, 8) } },
      options({ width: 20 }),
    )
    expect(output).toContain("activity · last 16 weeks")
  })
})

test("stats command preserves HTTP cost coverage in text and JSON output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-cost-display-"))
  const payload: SessionStatsInfo = {
    ...stats,
    costCoverage: { reported: 1, estimated: 0, unknown: 1, legacy: 0 },
    models: [{ ...stats.models[0], cost: 0, costCoverage: { reported: 0, estimated: 0, unknown: 1, legacy: 0 } }],
  }
  const requests: URL[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info")
        return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: root } })
      if (url.pathname === "/api/experimental/session/stats") {
        requests.push(url)
        return Response.json({ data: payload })
      }
      return new Response("Not found", { status: 404 })
    },
  })
  try {
    for (const flags of [["--cost", "--models"], ["--json"]]) {
      const child = Bun.spawn(
        [process.execPath, "run", "src/index.ts", "stats", "--server", server.url.toString(), ...flags],
        {
          cwd: path.join(import.meta.dir, ".."),
          env: {
            ...process.env,
            XDG_DATA_HOME: path.join(root, "data"),
            XDG_CONFIG_HOME: path.join(root, "config"),
            XDG_CACHE_HOME: path.join(root, "cache"),
            XDG_STATE_HOME: path.join(root, "state"),
            OPENCODE_CONFIG_DIR: path.join(root, "config"),
            REDCODE_CONFIG_DIR: path.join(root, "config"),
            OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
            NO_COLOR: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 })
      if (flags.includes("--json")) {
        expect(JSON.parse(stdout)).toEqual(payload)
        continue
      }
      expect(stdout).toContain("known subtotal")
      expect(stdout).toContain("$12.34+")
      expect(stdout).toContain("unknown records     1")
      expect(stdout).toContain("unknown")
      expect(stdout).not.toContain("$0.00")
    }
    expect(requests.map((url) => url.searchParams.get("tools"))).toEqual(["none", "detail"])
  } finally {
    server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

describe("stats requests", () => {
  test("maps transport failures to the server URL", async () => {
    const cause = new ClientError("Transport")
    const error = await Effect.runPromise(Effect.flip(request("http://localhost:4096", () => Promise.reject(cause))))
    expect(error).toEqual(new Error("Could not reach server at http://localhost:4096", { cause }))
  })

  test("preserves declared API errors", async () => {
    const cause = { _tag: "InvalidRequestError", message: "Stats range must end after it starts" } as const
    const error = await Effect.runPromise(Effect.flip(request("http://localhost:4096", () => Promise.reject(cause))))
    expect(error).toBe(cause)
  })

  test("preserves unexpected response failures", async () => {
    const cause = new ClientError("UnexpectedStatus", { cause: { status: 500 } })
    const error = await Effect.runPromise(Effect.flip(request("http://localhost:4096", () => Promise.reject(cause))))
    expect(error).toBe(cause)
  })
})

function options(input: Partial<Parameters<typeof renderStats>[1]> = {}): Parameters<typeof renderStats>[1] {
  return {
    label: "2026 so far",
    scope: "all projects",
    models: false,
    tools: false,
    cost: false,
    limit: 5,
    color: false,
    width: 80,
    ...input,
  }
}
