import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionTodo } from "@opencode/schema/session-todo"
import { Session } from "@opencode/schema/session"
import { AbsolutePath } from "@opencode/schema/schema"
import { SessionTaskGraph } from "../src/session/task-graph"
import { SessionTaskIntegration } from "../src/session/task-integration"
import { SessionTaskAssignments } from "../src/session/task-assignments"
import { SessionTaskFacts } from "../src/session/task-facts"

function fixture() {
  const input: SessionTodo.Info = {
    id: "todo_input",
    revision: 1,
    content: "Implement",
    status: "completed",
    priority: "high",
    evidence: {
      callID: "check-input",
      messageID: "msg_input",
      explanation: "Input checks passed",
      tool: "shell",
      hash: "proof-input",
      observed: 10,
    },
  }
  const target: SessionTodo.Info = {
    id: "todo_target",
    revision: 1,
    content: "Integrate",
    status: "completed",
    priority: "high",
    dependencies: ["todo_input"],
    evidence: {
      callID: "check-joint",
      messageID: "msg_joint",
      explanation: "Combined checks passed",
      tool: "shell",
      hash: "proof-joint",
      observed: 200,
    },
  }
  const assignment: SessionTaskAssignments.Assignment = {
    taskID: "todo_input",
    sessionID: Session.ID.make("ses_child"),
    directory: AbsolutePath.make("/worktree"),
    workspaceID: undefined,
    revision: 1,
    assigned: 1,
    promptID: "msg_prompt",
    fingerprint: SessionTaskGraph.fingerprint(input, [input, target]),
    outcome: "succeeded",
    busy: false,
    admission: "delivered",
    current: true,
    state: "settled",
    settledAt: 10,
    review: "unverified",
  }
  const task = {
    ...target,
    integration: Schema.decodeUnknownSync(SessionTodo.Integration)({
      fingerprint: SessionTaskGraph.fingerprint(target, [input, target]),
      preparedAt: 100,
      target: "/repo",
      targetHead: "a".repeat(40),
      head: "b".repeat(40),
      tree: "c".repeat(40),
      sources: [
        {
          taskID: "todo_input",
          taskRevision: 1,
          fingerprint: assignment.fingerprint,
          sessionID: assignment.sessionID,
          promptID: assignment.promptID,
          sessionDirectory: assignment.directory,
          directory: "/worktree",
          head: "d".repeat(40),
        },
      ],
    }),
  }
  const proof: SessionTaskFacts.Result = {
    callID: "check-joint",
    messageID: "msg_joint",
    tool: "shell",
    hash: "proof-joint",
    completed: 200,
    successful: true,
    errored: false,
    kind: "verification",
    paths: [],
    settled: true,
    abandoned: false,
    error: "",
    exit: 0,
    input: { command: "bun test" },
    summary: "Integration tests passed",
  }
  return { input, task, tasks: [input, task], assignment, proof }
}

test("requires a fresh verification for a bound candidate and never accepts bookkeeping as proof", () => {
  const state = fixture()
  expect(
    SessionTaskIntegration.completionError(state.task, state.tasks, [state.assignment], [state.proof]),
  ).toBeUndefined()
  expect(
    SessionTaskIntegration.completionError(
      state.task,
      state.tasks,
      [state.assignment],
      [{ ...state.proof, completed: 100 }],
    ),
  ).toContain("fresh verification")
  expect(
    SessionTaskIntegration.completionError(
      state.task,
      state.tasks,
      [state.assignment],
      [{ ...state.proof, kind: "bookkeeping" }],
    ),
  ).toContain("fresh verification")
})

test("invalidates the binding when criteria or accepted prerequisite evidence changes", () => {
  const state = fixture()
  expect(
    SessionTaskIntegration.issues({ ...state.task, criterion: "New criterion" }, state.tasks, [state.assignment]),
  ).not.toHaveLength(0)
  expect(
    SessionTaskIntegration.issues(
      state.task,
      [{ ...state.input, evidence: { ...state.input.evidence!, hash: "changed" } }, state.task],
      [state.assignment],
    ),
  ).not.toHaveLength(0)
  expect(SessionTaskIntegration.issues({ ...state.task, dependencies: [] }, state.tasks, [state.assignment])).toContain(
    "The candidate does not cover exactly the required tasks",
  )
})

test("invalidates continued, moved, missing, stale and busy source delegations", () => {
  const state = fixture()
  const variants = [
    { ...state.assignment, promptID: "msg_continuation" },
    { ...state.assignment, directory: AbsolutePath.make("/moved") },
    { ...state.assignment, current: false },
    { ...state.assignment, state: "running" as const },
  ]
  variants.forEach((assignment) =>
    expect(SessionTaskIntegration.issues(state.task, state.tasks, [assignment])).not.toHaveLength(0),
  )
  expect(SessionTaskIntegration.issues(state.task, state.tasks, [])).not.toHaveLength(0)
  expect(
    SessionTaskGraph.proof({ ...state.task, integration: { ...state.task.integration, head: "e".repeat(40) } }),
  ).not.toBe(SessionTaskGraph.proof(state.task))
})
