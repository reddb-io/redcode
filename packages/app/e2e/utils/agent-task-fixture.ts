import type { Page } from "@playwright/test"
import type {
  Todo,
  TodoGraphNode,
  TodoAssignment,
  TodoReconciliation,
  WorktreeIntegrationCandidate,
} from "@opencode/client/promise"
import { Schema } from "effect"
import { SessionTodo } from "@opencode/schema/session-todo"
import { Worktree } from "@opencode/schema/worktree"
import { fixture } from "./session-fixture"

export async function mockAgentTasks(page: Page) {
  const sessionID = fixture.sessions[0].id
  const operations: { action: string; input: unknown }[] = []
  const sources = ["api", "tests"].map((id) => ({ directory: fixture.directory + "/" + id, head: "a".repeat(40) }))
  const candidate: WorktreeIntegrationCandidate = {
    projectID: fixture.project.id,
    target: fixture.directory,
    targetHead: "b".repeat(40),
    sources,
    status: "ready",
    head: "c".repeat(40),
    tree: "d".repeat(40),
    steps: sources.map((source) => ({ ...source, status: "merged", conflicts: [] })),
    diff: "diff --git a/src/tasks.ts b/src/tasks.ts\n+export const reconciled = true",
    truncated: false,
  }
  const tasks: Todo[] = [
    ...["api", "tests"].map((id) => ({
      id,
      revision: 2,
      content: id === "api" ? "Implement task API" : "Verify task API",
      status: "completed",
      priority: "high",
      evidence: {
        callID: "check-" + id,
        messageID: "message-" + id,
        explanation: "The task passed its checks",
        tool: "bash",
        hash: "proof-" + id,
        observed: 1,
      },
    })),
    {
      id: "combine",
      revision: 3,
      content: "Reconcile delegated results",
      status: "pending",
      priority: "high",
      criterion: "The combined candidate passes the project checks",
      dependencies: ["api", "tests"],
      integrationApplication: {
        requestID: "older-application",
        taskRevision: 1,
        fingerprint: "older-inputs",
        target: fixture.directory,
        targetHead: "e".repeat(40),
        head: "f".repeat(40),
        tree: "0".repeat(40),
        started: 1,
        completed: 2,
        state: "applied",
      },
    },
  ]
  const nodes: TodoGraphNode[] = [
    { id: "api", revision: 2, dependencies: [], waitingFor: [], ready: false },
    { id: "tests", revision: 2, dependencies: [], waitingFor: [], ready: false },
    { id: "combine", revision: 3, dependencies: ["api", "tests"], waitingFor: [], ready: true },
  ]
  const assignments: TodoAssignment[] = [
    {
      taskID: "api",
      sessionID: fixture.sessions[2].id,
      directory: sources[0].directory,
      revision: 2,
      current: true,
      state: "settled",
      outcome: "succeeded",
      review: "unverified",
    },
  ]
  const state = {
    accepted: false,
    graphUnavailable: false,
    reportUnavailable: false,
    applied: false,
    executionSettled: true,
    acceptanceReady: true,
    inputAcceptance: ["accepted", "accepted"] as TodoReconciliation["inputs"][number]["acceptance"][],
  }
  const report = (taskID: string): TodoReconciliation => ({
    sessionID,
    task: tasks.find((task) => task.id === taskID)!,
    fingerprint: "fixture-inputs",
    observedAt: 1,
    executionSettled: state.executionSettled,
    acceptanceReady: state.acceptanceReady,
    inputs: (taskID === "combine" ? tasks.slice(0, 2) : []).map((task, index) => ({
      task,
      acceptance: state.inputAcceptance[index],
      issues: [],
      contributions: [
        {
          sessionID: fixture.sessions[2].id,
          taskRevision: assignments.find((entry) => entry.taskID === task.id)?.revision ?? task.revision!,
          promptID: "prompt-" + task.id,
          fingerprint: "fingerprint-" + task.id,
          current: assignments.find((entry) => entry.taskID === task.id)?.current ?? true,
          execution:
            assignments.find((entry) => entry.taskID === task.id)?.state === "running" ? "running" : "succeeded",
          response: {
            messageID: "response-" + task.id,
            text: "Delegated result for " + task.id,
            hash: "response-hash",
            bytes: 20,
            truncated: false,
          },
          checks: [
            {
              callID: "check-" + task.id,
              messageID: "message-" + task.id,
              tool: "bash",
              hash: "check-hash",
              completed: 1,
              successful: true,
              settled: true,
              fresh: true,
            },
          ],
          omittedChecks: index,
          changedPaths: ["src/tasks.ts"],
          omittedPaths: 0,
          unknownWriteScope: false,
        },
      ],
    })),
    ...(tasks[2].integration
      ? { integration: { binding: tasks[2].integration, contractCurrent: true, issues: [] } }
      : {}),
    overlaps: [{ path: "src/tasks.ts", taskIDs: ["api", "tests"] }],
  })
  await page.route("**/api/experimental/session/*/goal", (route) =>
    route.fulfill({
      json: {
        data: {
          id: "goal-fixture",
          sessionID,
          revision: 1,
          objective: "Deliver a verified task workflow",
          criteria: ["All task contributions are reconciled"],
          gates: [],
          stopAfter: "build",
          executePlan: true,
          status: "active",
          reason: "",
          turns: { used: 1, max: 10 },
          tokens: 100,
          reviews: 0,
          evidence: [],
          checks: [],
          created: 1,
          updated: 1,
        },
      },
    }),
  )
  await page.route("**/api/session/*/todo**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === "GET") {
      if (pathname.endsWith("/graph")) {
        if (state.graphUnavailable) return route.fulfill({ status: 500, json: { message: "Task graph unavailable" } })
        return route.fulfill({ json: { data: { sessionID, tasks, nodes, assignments } } })
      }
      if (pathname.endsWith("/reconciliation")) {
        if (state.reportUnavailable) return route.fulfill({ status: 500, json: { message: "Task report unavailable" } })
        return route.fulfill({ json: { data: report(pathname.split("/").at(-2)!) } })
      }
      return route.fulfill({ json: { data: tasks } })
    }
    if (pathname.endsWith("/apply")) {
      const input = Schema.decodeUnknownSync(SessionTodo.ApplyIntegrationInput)(request.postDataJSON())
      operations.push({ action: "apply", input })
      const previous = tasks[2].integrationApplication?.requestID === input.requestID
      tasks[2] = {
        ...tasks[2],
        revision: 6,
        integrationApplication: {
          ...input,
          taskRevision: input.revision,
          fingerprint: "fixture-inputs",
          target: candidate.target,
          targetHead: candidate.targetHead,
          head: input.candidateHead,
          tree: candidate.tree!,
          started: 1,
          state: previous ? "applied" : "pending",
          ...(previous ? { completed: 2 } : {}),
        },
      }
      if (!previous) return route.abort("failed")
      state.applied = true
      return route.fulfill({ json: { data: tasks[2].integrationApplication } })
    }
    const input = Schema.decodeUnknownSync(SessionTodo.PrepareIntegrationInput)(request.postDataJSON())
    operations.push({ action: "prepare", input })
    tasks[2] = {
      ...tasks[2],
      revision: 4,
      integration: {
        fingerprint: "fixture-inputs",
        preparedAt: 1,
        target: input.target,
        targetHead: input.targetHead,
        head: candidate.head!,
        tree: candidate.tree!,
        sources: sources.map((source, index) => ({
          taskID: tasks[index].id!,
          taskRevision: 2,
          fingerprint: "fingerprint-" + tasks[index].id,
          sessionID: fixture.sessions[2].id,
          promptID: "prompt-" + tasks[index].id,
          sessionDirectory: source.directory,
          ...source,
        })),
      },
    }
    return route.fulfill({ json: { data: { task: tasks[2], candidate } } })
  })
  await page.route("**/api/worktree**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: [
          { directory: fixture.directory },
          ...sources.map((source) => ({ directory: source.directory, strategy: "git" })),
        ],
      })
    if (new URL(route.request().url()).pathname.endsWith("/inspect")) {
      const input = Schema.decodeUnknownSync(Worktree.InspectInput)(route.request().postDataJSON())
      return route.fulfill({
        json: {
          ...input,
          head: candidate.targetHead,
          targetHead: candidate.targetHead,
          branch: "main",
          dirty: false,
          targetDirty: false,
          status: "",
          diff: "",
          truncated: false,
          managed: false,
        },
      })
    }
    const input = Schema.decodeUnknownSync(Worktree.PrepareIntegrationInput)(route.request().postDataJSON())
    operations.push({ action: "review", input })
    return route.fulfill({ json: candidate })
  })
  return {
    sessionID,
    tasks,
    nodes,
    assignments,
    operations,
    state,
    accept() {
      state.accepted = true
      tasks[2] = {
        ...tasks[2],
        revision: 5,
        status: "completed",
        evidence: {
          callID: "combined-check",
          messageID: "combined-message",
          explanation: "The combined candidate passed the project checks",
          tool: "bash",
          hash: "combined-hash",
          observed: 2,
        },
      }
    },
  }
}
