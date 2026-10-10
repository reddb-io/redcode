import { expect, test } from "bun:test"
import { agentColor, resolveAgent } from "./agent"

const agents = [{ name: "plan" }, { name: "build" }, { name: "custom" }]

const rows: { name: string; agents: { name: string }[]; requested?: string; expected: string }[] = [
  { name: "the requested available agent", agents, requested: "custom", expected: "custom" },
  { name: "build without a request", agents, requested: undefined, expected: "build" },
  { name: "build for a missing agent", agents, requested: "missing", expected: "build" },
  {
    name: "the first agent when build is unavailable",
    agents: [{ name: "custom" }],
    requested: "missing",
    expected: "custom",
  },
]

test.each(rows)("resolveAgent uses $name", (row) => {
  expect(resolveAgent(row.agents, row.requested)?.name).toBe(row.expected)
})

test("agentColor keeps built-in identities, honours configured colours and cycles the series", () => {
  const visible = [
    { name: "custom" },
    { name: "plan" },
    { name: "build" },
    { name: "tinted", color: "#3366FF" },
    { name: "named", color: "primary" },
    { name: "a" },
    { name: "b" },
    { name: "c" },
  ]

  expect(agentColor(visible, "build")).toBe("var(--reddb-color-series-1)")
  expect(agentColor(visible, "plan")).toBe("var(--reddb-color-series-2)")
  expect(agentColor(visible, "custom")).toBe("var(--reddb-color-series-1)")
  expect(agentColor(visible, "tinted")).toBe("#3366FF")
  // Only a hex colour is safe to use as CSS; a theme name falls back to the agent's series.
  expect(agentColor(visible, "named")).toBe("var(--reddb-color-series-5)")
  expect(agentColor(visible, "c")).toBe("var(--reddb-color-series-2)")
  expect(agentColor(visible, "missing")).toBe("var(--reddb-color-series-1)")
})
