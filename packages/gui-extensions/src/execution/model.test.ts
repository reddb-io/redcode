import { describe, expect, test } from "bun:test"
import type { ExecutionGraphInfo } from "@opencode/client/promise"
import { graphCounts, graphRows } from "./model"

const graph: ExecutionGraphInfo = {
  rootSessionID: "ses_root",
  generatedAt: 1,
  truncated: { shells: false },
  nodes: [
    { id: "session:ses_root", kind: "session", sessionID: "ses_root", status: "running", started: 1, updated: 2 },
    { id: "session:ses_child", kind: "session", sessionID: "ses_child", status: "waiting", started: 2, updated: 3 },
    {
      id: "job:job_1",
      kind: "job",
      sessionID: "ses_root",
      status: "running",
      jobID: "job_1",
      jobType: "subagent",
      started: 2,
    },
    {
      id: "terminal:pty_1",
      kind: "terminal",
      sessionID: "ses_child",
      status: "running",
      ptyID: "pty_1",
      title: "Terminal",
      pid: 42,
    },
  ],
  edges: [{ from: "session:ses_root", to: "session:ses_child", relation: "delegates" }],
}

describe("execution graph projection", () => {
  test("groups work under its owning session and nests delegated sessions", () => {
    expect(graphRows(graph).map((row) => [row.node.id, row.depth])).toEqual([
      ["session:ses_root", 0],
      ["job:job_1", 1],
      ["session:ses_child", 1],
      ["terminal:pty_1", 2],
    ])
  })

  test("summarizes live work", () => {
    expect(graphCounts(graph)).toEqual({ sessions: 2, active: 4, jobs: 1, terminals: 1 })
  })
})
