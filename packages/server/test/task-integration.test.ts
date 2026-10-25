import path from "node:path"
import fs from "node:fs/promises"
import { $ } from "bun"
import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema, Struct } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Git } from "@opencode/core/git"
import { SessionIntegrationVerification } from "@opencode/core/session/integration-verification"
import { SessionTodoStore } from "@opencode/core/session/todo-store"
import { SessionTaskReconciliation } from "@opencode/core/session/task-reconciliation"
import { SessionTaskGraph } from "@opencode/core/session/task-graph"
import { SessionTaskFacts } from "@opencode/core/session/task-facts"
import { SessionGoal } from "@opencode/core/session/goal"
import { SessionTaskContext } from "@opencode/core/session/task-context"
import { TodoHistoryTable, TodoTable } from "@opencode/core/session/redcode.sql"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionTodo } from "@opencode/schema/session-todo"
import { AbsolutePath } from "@opencode/schema/schema"
import { SubagentReview } from "@opencode/schema/subagent-review"
import { Worktree } from "@opencode/schema/worktree"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { offlineModels } from "../../core/test/fixture/models"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { initRepo } from "../../core/test/fixture/git"
import { testEffect } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Global.node,
      Git.node,
      SessionTodoStore.node,
      SessionTaskReconciliation.node,
      SessionGoal.node,
      SessionTaskContext.node,
    ]),
    [Global.node.replace(tempGlobalLayer), offlineModels],
  ),
)

const saveMessage = Effect.fnUntraced(function* (sessionID: Session.ID, message: SessionMessage.Info, seq: number) {
  const database = yield* Database.Service
  yield* database.db
    .insert(SessionMessageTable)
    .values({
      id: message.id,
      type: message.type,
      data: Struct.omit(Schema.encodeSync(SessionMessage.Info)(message), ["id", "type"]),
      session_id: sessionID,
      seq,
    })
    .run()
})

const check = Effect.fnUntraced(function* (
  sessionID: Session.ID,
  directory: string,
  seq: number,
  file: string,
  command = ["git", "cat-file", "-e", `HEAD:${file}`],
  integration?: SessionTodo.Integration,
) {
  const git = yield* Git.Service
  const before = integration
    ? yield* SessionIntegrationVerification.observe(git, AbsolutePath.make(directory), integration.head)
    : undefined
  const started = Date.now()
  yield* Effect.promise(async () => {
    const process = Bun.spawn(command, { cwd: directory, stdout: "pipe", stderr: "pipe" })
    expect(await process.exited).toBe(0)
  })
  const after = integration
    ? yield* SessionIntegrationVerification.observe(git, AbsolutePath.make(directory), integration.head)
    : undefined
  if (integration) expect(after).toBe(before)
  const message = Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: "build",
    model: { providerID: "test", id: "test" },
    time: { created: Date.now(), completed: Date.now() },
    finish: "stop",
    content: [
      {
        type: "tool",
        id: `check-${seq}`,
        name: "shell",
        executed: true,
        time: { created: Date.now(), completed: Date.now() },
        state: {
          status: "completed",
          input: { command: command.join(" "), workdir: directory },
          content: [{ type: "text", text: "Verification passed with exit 0" }],
          metadata: {
            exit: 0,
            ...(integration && before && after
              ? {
                  integrationVerification: {
                    sessionID,
                    taskID: "todo_joint",
                    fingerprint: integration.fingerprint,
                    head: integration.head,
                    tree: integration.tree,
                    directory: after,
                    command: command.join(" "),
                    started,
                    completed: Date.now(),
                  },
                }
              : {}),
          },
        },
      },
    ],
  })
  yield* saveMessage(sessionID, message, seq)
  const fact = SessionTaskFacts.project([message], directory, sessionID)[0]!
  return {
    callID: fact.callID,
    messageID: fact.messageID,
    tool: fact.tool,
    hash: fact.hash,
    observed: fact.completed,
    explanation: "The committed worktree contains the required component",
  }
})

const fixture = Effect.fnUntraced(function* (conflict = false, subdirectory = false) {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("redcode-task-candidate-")))
  const target = path.join(tmp.path, "repo")
  yield* Effect.promise(async () => {
    await fs.mkdir(target)
    await initRepo(target)
  })
  const database = yield* Database.Service
  const global = yield* Global.Service
  const handler = yield* ServerFetch.make(
    {
      app: { version: "test" },
      database: { path: ":memory:" },
      config: { directory: path.join(tmp.path, "config"), project: false, global: false },
      models: { fetch: false },
      fs: { filewatcher: false },
      password: "secret",
    },
    {
      overrides: [
        Database.node.replace(Layer.succeed(Database.Service, database)),
        Global.node.replace(Layer.succeed(Global.Service, global)),
      ],
    },
  )
  const headers = { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" }
  const request = (url: string, body?: unknown) =>
    handler(
      new Request(`http://opencode.local${url}`, {
        headers,
        ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
      }),
    )
  const parent = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
    yield* Effect.promise(async () =>
      (await request("/api/session", { location: { directory: target }, metadata: { reasoning: "single" } })).json(),
    ),
  ).data
  const goals = yield* SessionGoal.Service
  const contexts = yield* SessionTaskContext.Service
  yield* goals.start(parent.id, {
    objective: "Combine both components",
    criteria: ["The combined candidate passes project checks"],
  })
  const shared = yield* contexts.get(parent.id)
  const tasks: SessionTodo.Info[] = [
    {
      id: "todo_sum",
      revision: 1,
      content: "Commit sum component",
      status: "completed",
      priority: "high",
      criterion: "Sum component is committed",
      source: { type: "request", id: "msg_requirement", quote: "Combine both components", created: 1 },
    },
    {
      id: "todo_run",
      revision: 1,
      content: "Commit run component",
      status: "completed",
      priority: "high",
      criterion: "Run component is committed",
      source: { type: "request", id: "msg_requirement", quote: "Combine both components", created: 1 },
    },
    {
      id: "todo_joint",
      revision: 1,
      content: "Integrate components",
      status: "pending",
      priority: "high",
      dependencies: ["todo_sum", "todo_run"],
      criterion: "Combined result passes validation",
      source: { type: "request", id: "msg_requirement", quote: "Combine both components", created: 1 },
    },
  ]
  const children = yield* Effect.forEach(tasks.slice(0, 2), (task, index) =>
    Effect.gen(function* () {
      const worktree = Schema.decodeUnknownSync(Worktree.Info)(
        yield* Effect.promise(async () =>
          (await request("/api/worktree", { projectID: parent.projectID, name: `result-${index}` })).json(),
        ),
      )
      yield* Effect.promise(async () => {
        await Bun.write(
          path.join(worktree.directory, conflict ? "shared.ts" : index === 0 ? "sum.ts" : "run.ts"),
          index === 0
            ? "export const sum = (a: number, b: number) => a + b\n"
            : "import { sum } from './sum'; export const run = (a: number, b: number) => 2 * sum(a, b)\n",
        )
        await $`git add --all`.cwd(worktree.directory).quiet()
        await $`git commit -m component-result`.cwd(worktree.directory).quiet()
      })
      const promptID = SessionMessage.ID.create()
      const metadata = SubagentReview.write(
        {},
        {
          prompt: task.content,
          agent: "build",
          scope: [],
          criteria: [],
          writeCapable: true,
          parentSessionID: parent.id,
          task: {
            id: task.id!,
            revision: 1,
            fingerprint: SessionTaskGraph.fingerprint(task, tasks),
            promptID,
            assigned: 1,
            context: shared,
          },
          verdict: "skipped",
          issues: [],
          created: 1,
          completion: { promptID, status: "completed", at: 2 },
        },
      )
      const child = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
        yield* Effect.promise(async () =>
          (
            await request("/api/session", {
              parentID: parent.id,
              location: { directory: worktree.directory },
              metadata,
            })
          ).json(),
        ),
      ).data
      yield* saveMessage(
        child.id,
        Schema.decodeUnknownSync(SessionMessage.User)({
          id: promptID,
          type: "user",
          text: task.content,
          time: { created: 1 },
        }),
        1,
      )
      // Persisted fixture placement: real child admission inherits the parent until a subsequent move.
      const placement = subdirectory ? path.join(worktree.directory, "nested") : worktree.directory
      if (subdirectory) yield* Effect.promise(() => fs.mkdir(placement))
      yield* database.db.update(SessionTable).set({ directory: placement }).where(eq(SessionTable.id, child.id)).run()
      return Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
        yield* Effect.promise(async () => (await request(`/api/session/${child.id}`)).json()),
      ).data
    }),
  )
  yield* saveMessage(
    parent.id,
    Schema.decodeUnknownSync(SessionMessage.User)({
      id: "msg_requirement",
      type: "user",
      text: "Combine both components",
      time: { created: 1 },
    }),
    1,
  )
  const proofs = yield* Effect.forEach(children, (child, index) =>
    check(parent.id, child.location.directory, index + 2, conflict ? "shared.ts" : index === 0 ? "sum.ts" : "run.ts"),
  )
  const persisted = tasks.map((task, position) => ({
    ...task,
    ...(position < 2 ? { evidence: proofs[position] } : {}),
  }))
  yield* database.db
    .insert(TodoTable)
    .values(
      persisted.map((task, position) => ({
        session_id: parent.id,
        task_id: task.id,
        revision: 1,
        content: task.content,
        status: task.status,
        priority: task.priority,
        position,
        details: {
          criterion: task.criterion,
          source: task.source,
          dependencies: task.dependencies,
          evidence: task.evidence,
        },
      })),
    )
    .run()
  const url = `/api/session/${parent.id}/todo/todo_joint/integration`
  const input = {
    revision: 1,
    target,
    targetHead: yield* Effect.promise(async () => (await $`git rev-parse HEAD`.cwd(target).quiet()).text().trim()),
  }
  return { database, request, handler, headers, parent, tasks: persisted, children, url, input, target }
})

it.live(
  "binds a joint revision from accepted sessions and preserves provenance through task updates",
  () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const todos = yield* SessionTodoStore.Service
      const denied = yield* Effect.promise(() =>
        state.handler(
          new Request(`http://opencode.local${state.url}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(state.input),
          }),
        ),
      )
      expect(denied.status).toBe(401)
      const response = yield* Effect.promise(() => state.request(state.url, state.input))
      expect(response.status).toBe(200)
      const prepared = Schema.decodeUnknownSync(Schema.Struct({ data: SessionTodo.IntegrationPreparation }))(
        yield* Effect.promise(() => response.json()),
      ).data
      expect(prepared.task).toMatchObject({ id: "todo_joint", revision: 2, status: "pending" })
      expect(prepared.task.integration?.head).toBe(prepared.candidate.head)
      expect(prepared.task.integration?.sources.map((source) => source.sessionID)).toEqual(
        state.children.map((child) => child.id),
      )
      expect(prepared.task.integration?.sources.map((source) => source.taskID)).toEqual(["todo_sum", "todo_run"])
      expect((yield* todos.get(state.parent.id))[2]?.integration).toEqual(prepared.task.integration)
      const reconciliation = yield* SessionTaskReconciliation.Service
      expect((yield* reconciliation.inspect(state.parent.id, "todo_joint")).integration).toMatchObject({
        contractCurrent: true,
        issues: [],
      })
      const retry = yield* Effect.promise(() => state.request(state.url, { ...state.input, revision: 2 }))
      const repeated = Schema.decodeUnknownSync(Schema.Struct({ data: SessionTodo.IntegrationPreparation }))(
        yield* Effect.promise(() => retry.json()),
      ).data
      expect(repeated.task).toEqual(prepared.task)
      const history = yield* state.database.db
        .select()
        .from(TodoHistoryTable)
        .where(eq(TodoHistoryTable.session_id, state.parent.id))
        .all()
      expect(history.filter((entry) => entry.task_id === "todo_joint").map((entry) => entry.revision)).toEqual([1, 2])
      yield* todos.write({ sessionID: state.parent.id, todos: [{ id: "todo_joint", priority: "low" }] })
      expect((yield* todos.get(state.parent.id))[2]?.integration).toEqual(prepared.task.integration)
      const tooOld = yield* todos
        .write({
          sessionID: state.parent.id,
          todos: [
            {
              id: "todo_joint",
              status: "completed",
              evidence: {
                callID: state.tasks[0]!.evidence!.callID,
                explanation: "The committed components exist in the required worktrees",
              },
            },
          ],
        })
        .pipe(Effect.flip)
      expect(tooOld.message).toContain("fresh verification")
      yield* Effect.promise(() =>
        $`git worktree add --detach ${path.join(state.target, "..", "validation")} ${prepared.candidate.head}`
          .cwd(state.target)
          .quiet(),
      )
      const validation = path.join(state.target, "..", "validation")
      const proof = yield* check(
        state.parent.id,
        validation,
        4,
        "run.ts",
        ["bun", "-e", "import { run } from './run'; if (run(2,3) !== 10) process.exit(1)"],
        prepared.task.integration,
      )
      const completed = yield* todos.write({
        sessionID: state.parent.id,
        todos: [
          {
            id: "todo_joint",
            status: "completed",
            evidence: {
              callID: proof.callID,
              explanation: "The combined checkout was executed and the integration assertion passed",
            },
          },
        ],
      })
      expect(completed.todos[2]?.status).toBe("completed")
      const applyURL = `${state.url}/apply`
      const applyInput = {
        requestID: "apply-accepted-joint",
        revision: completed.todos[2]!.revision!,
        candidateHead: prepared.candidate.head!,
      }
      const wrongSHA = yield* Effect.promise(() =>
        state.request(applyURL, { ...applyInput, candidateHead: state.input.targetHead }),
      )
      expect(wrongSHA.status).toBe(400)
      yield* Effect.promise(() => Bun.write(path.join(state.target, "untracked.txt"), "keep this file"))
      const dirty = yield* Effect.promise(() => state.request(applyURL, applyInput))
      expect(dirty.status).toBe(400)
      expect((yield* todos.get(state.parent.id))[2]?.integrationApplication).toBeUndefined()
      yield* Effect.promise(() => fs.unlink(path.join(state.target, "untracked.txt")))
      const acceptedProof = SessionTaskGraph.proof(completed.todos[2]!)
      const appliedResponse = yield* Effect.promise(() => state.request(applyURL, applyInput))
      expect(appliedResponse.status).toBe(200)
      const applied = Schema.decodeUnknownSync(Schema.Struct({ data: SessionTodo.IntegrationApplication }))(
        yield* Effect.promise(() => appliedResponse.json()),
      ).data
      expect(applied).toMatchObject({
        state: "applied",
        head: prepared.candidate.head,
        target: state.target,
        requestID: applyInput.requestID,
      })
      expect(applied.completed!).toBeGreaterThanOrEqual(applied.started)
      expect(
        yield* Effect.promise(async () => (await $`git rev-parse HEAD`.cwd(state.target).quiet()).text().trim()),
      ).toBe(prepared.candidate.head!)
      expect(
        yield* Effect.promise(async () => (await $`git status --porcelain`.cwd(state.target).quiet()).text().trim()),
      ).toBe("")
      expect(SessionTaskGraph.proof((yield* todos.get(state.parent.id))[2]!)).toBe(acceptedProof)
      expect((yield* todos.review(state.parent.id))[2]?.status).toBe("completed")
      const repeatedApply = yield* Effect.promise(() => state.request(applyURL, applyInput))
      expect(repeatedApply.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(Schema.Struct({ data: SessionTodo.IntegrationApplication }))(
          yield* Effect.promise(() => repeatedApply.json()),
        ).data,
      ).toEqual(applied)
      const reused = yield* Effect.promise(() =>
        state.request(applyURL, { ...applyInput, revision: applyInput.revision + 1 }),
      )
      expect(reused.status).toBe(400)
      // Host-owned receipt survives ordinary updates and remains separate from evidence.
      yield* todos.write({ sessionID: state.parent.id, todos: [{ id: "todo_joint", priority: "medium" }] })
      expect((yield* todos.get(state.parent.id))[2]?.integrationApplication).toEqual(applied)
      const changed = SubagentReview.read(state.children[0]!.metadata)!
      yield* state.database.db
        .update(SessionTable)
        .set({
          metadata: SubagentReview.write(state.children[0]!.metadata, {
            ...changed,
            task: { ...changed.task!, promptID: "msg_new_assignment" },
          }),
        })
        .where(eq(SessionTable.id, state.children[0]!.id))
        .run()
      expect((yield* reconciliation.inspect(state.parent.id, "todo_joint")).integration?.contractCurrent).toBe(false)
      expect((yield* todos.review(state.parent.id))[2]?.status).not.toBe("completed")
    }),
  30_000,
)

it.live(
  "resolves a contributing session subdirectory to its managed checkout root",
  () =>
    Effect.gen(function* () {
      const state = yield* fixture(false, true)
      const response = yield* Effect.promise(() => state.request(state.url, state.input))
      expect(response.status).toBe(200)
      const prepared = Schema.decodeUnknownSync(Schema.Struct({ data: SessionTodo.IntegrationPreparation }))(
        yield* Effect.promise(() => response.json()),
      ).data
      expect(
        prepared.task.integration?.sources.every(
          (source) => path.join(source.directory, "nested") === source.sessionDirectory,
        ),
      ).toBe(true)
    }),
  30_000,
)

it.live(
  "reports conflicting sources without writing a candidate binding",
  () =>
    Effect.gen(function* () {
      const state = yield* fixture(true)
      const response = yield* Effect.promise(() => state.request(state.url, state.input))
      expect(response.status).toBe(200)
      const prepared = Schema.decodeUnknownSync(Schema.Struct({ data: SessionTodo.IntegrationPreparation }))(
        yield* Effect.promise(() => response.json()),
      ).data
      expect(prepared.candidate.status).toBe("conflicted")
      expect(prepared.candidate.steps[1]?.conflicts).toEqual(["shared.ts"])
      expect(prepared.task.integration).toBeUndefined()
      const todos = yield* SessionTodoStore.Service
      expect((yield* todos.get(state.parent.id))[2]?.revision).toBe(1)
    }),
  30_000,
)

it.live(
  "refuses combining contributions captured under an earlier shared objective",
  () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const goals = yield* SessionGoal.Service
      const reconciliation = yield* SessionTaskReconciliation.Service
      yield* goals.control(state.parent.id, { action: "pause" })
      yield* goals.start(state.parent.id, { objective: "Combine the components with a new compatibility constraint" })
      const report = yield* reconciliation.inspect(state.parent.id, "todo_joint")
      expect(report.inputs.map((input) => input.acceptance)).toEqual(["stale", "stale"])
      expect(report.convergence).toMatchObject({ waitingFor: ["todo_sum", "todo_run"], ready: false })
      const rejected = yield* Effect.promise(() => state.request(state.url, state.input))
      expect(rejected.status).toBe(400)
      expect(yield* Effect.promise(() => rejected.text())).toContain("Accept and settle")
      expect(
        yield* Effect.promise(async () => (await $`git rev-parse HEAD`.cwd(state.target).quiet()).text().trim()),
      ).toBe(state.input.targetHead)
    }),
  30_000,
)

it.live(
  "refuses stale revisions, missing acceptance, foreign tasks and untracked contributions",
  () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      expect((yield* Effect.promise(() => state.request(state.url, { ...state.input, revision: 9 }))).status).toBe(400)
      expect(
        (yield* Effect.promise(() => state.request(state.url.replace("todo_joint", "missing"), state.input))).status,
      ).toBe(400)
      expect(
        (yield* Effect.promise(() => state.request(state.url.replace(state.parent.id, "ses_missing"), state.input)))
          .status,
      ).toBe(404)
      yield* state.database.db
        .update(TodoTable)
        .set({ status: "pending" })
        .where(eq(TodoTable.task_id, "todo_sum"))
        .run()
      const pending = yield* Effect.promise(() => state.request(state.url, state.input))
      expect(pending.status).toBe(400)
      expect(yield* Effect.promise(() => pending.text())).toContain("Accept and settle")
      yield* state.database.db
        .update(TodoTable)
        .set({ status: "completed" })
        .where(eq(TodoTable.task_id, "todo_sum"))
        .run()
      yield* state.database.db
        .update(SessionTable)
        .set({ metadata: {} })
        .where(eq(SessionTable.id, state.children[0]!.id))
        .run()
      const untracked = yield* Effect.promise(() => state.request(state.url, state.input))
      expect(untracked.status).toBe(400)
      expect(yield* Effect.promise(() => untracked.text())).toContain("tracked contribution")
    }),
  30_000,
)

const acceptedCandidate = Effect.fnUntraced(function* () {
  const state = yield* fixture()
  const response = yield* Effect.promise(() => state.request(state.url, state.input))
  expect(response.status).toBe(200)
  const prepared = Schema.decodeUnknownSync(Schema.Struct({ data: SessionTodo.IntegrationPreparation }))(
    yield* Effect.promise(() => response.json()),
  ).data
  const todos = yield* SessionTodoStore.Service
  const rejected = yield* Effect.promise(() =>
    state.request(`${state.url}/apply`, {
      requestID: "not-accepted",
      revision: prepared.task.revision!,
      candidateHead: prepared.candidate.head!,
    }),
  )
  expect(rejected.status).toBe(400)
  const directory = path.join(state.target, "..", "validation")
  yield* Effect.promise(() =>
    $`git worktree add --detach ${directory} ${prepared.candidate.head}`.cwd(state.target).quiet(),
  )
  const proof = yield* check(
    state.parent.id,
    directory,
    4,
    "run.ts",
    ["bun", "-e", "import { run } from './run'; if (run(2,3) !== 10) process.exit(1)"],
    prepared.task.integration,
  )
  const completed = yield* todos.write({
    sessionID: state.parent.id,
    todos: [
      {
        id: "todo_joint",
        status: "completed",
        evidence: { callID: proof.callID, explanation: "The combined checkout executes the required result" },
      },
    ],
  })
  return { ...state, prepared, task: completed.todos[2]! }
})

it.live(
  "reconciles a persisted pending application after Git completed without replaying hooks",
  () =>
    Effect.gen(function* () {
      const state = yield* acceptedCandidate()
      const todos = yield* SessionTodoStore.Service
      const binding = state.task.integration!
      const application: SessionTodo.IntegrationApplication = {
        requestID: "interrupted-apply",
        taskRevision: state.task.revision!,
        fingerprint: binding.fingerprint,
        head: binding.head,
        tree: binding.tree,
        target: binding.target,
        targetHead: binding.targetHead,
        started: Date.now(),
        state: "pending",
      }
      yield* todos.recordIntegrationApplication({
        sessionID: state.parent.id,
        taskID: state.task.id!,
        revision: state.task.revision!,
        application,
      })
      yield* Effect.promise(() => $`git merge --ff-only ${binding.head}`.cwd(state.target).quiet())
      // A second merge would invoke this real post-merge hook, even when already up to date.
      const marker = path.join(state.target, "hook-invoked")
      yield* Effect.promise(async () => {
        const hooks = path.join(state.target, ".git", "hooks")
        await Bun.write(path.join(hooks, "post-merge"), `#!/bin/sh\ntouch '${marker}'\n`)
        await fs.chmod(path.join(hooks, "post-merge"), 0o755)
      })
      const response = yield* Effect.promise(() =>
        state.request(`${state.url}/apply`, {
          requestID: application.requestID,
          revision: application.taskRevision,
          candidateHead: application.head,
        }),
      )
      expect(response.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(Schema.Struct({ data: SessionTodo.IntegrationApplication }))(
          yield* Effect.promise(() => response.json()),
        ).data.state,
      ).toBe("applied")
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
    }),
  30_000,
)

it.live(
  "leaves interrupted admission pending at the old target and rejects replacement requests",
  () =>
    Effect.gen(function* () {
      const state = yield* acceptedCandidate()
      const todos = yield* SessionTodoStore.Service
      const binding = state.task.integration!
      const application: SessionTodo.IntegrationApplication = {
        requestID: "admitted-only",
        taskRevision: state.task.revision!,
        fingerprint: binding.fingerprint,
        head: binding.head,
        tree: binding.tree,
        target: binding.target,
        targetHead: binding.targetHead,
        started: Date.now(),
        state: "pending",
      }
      yield* todos.recordIntegrationApplication({
        sessionID: state.parent.id,
        taskID: state.task.id!,
        revision: state.task.revision!,
        application,
      })
      const input = {
        requestID: application.requestID,
        revision: application.taskRevision,
        candidateHead: application.head,
      }
      const response = yield* Effect.promise(() => state.request(`${state.url}/apply`, input))
      expect(response.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(Schema.Struct({ data: SessionTodo.IntegrationApplication }))(
          yield* Effect.promise(() => response.json()),
        ).data,
      ).toEqual(application)
      const current = (yield* todos.get(state.parent.id))[2]!
      const replacement = yield* Effect.promise(() =>
        state.request(`${state.url}/apply`, { ...input, requestID: "replacement", revision: current.revision! }),
      )
      expect(replacement.status).toBe(400)
      expect(
        yield* Effect.promise(async () => (await $`git rev-parse HEAD`.cwd(state.target).quiet()).text().trim()),
      ).toBe(binding.targetHead)
      // A dirty candidate target cannot be mistaken for a completed physical application.
      yield* Effect.promise(async () => {
        await $`git merge --ff-only ${binding.head}`.cwd(state.target).quiet()
        await Bun.write(path.join(state.target, "untracked.txt"), "requires review")
      })
      const dirty = yield* Effect.promise(() => state.request(`${state.url}/apply`, input))
      expect(
        Schema.decodeUnknownSync(Schema.Struct({ data: SessionTodo.IntegrationApplication }))(
          yield* Effect.promise(() => dirty.json()),
        ).data.state,
      ).toBe("pending")
    }),
  30_000,
)

for (const location of ["source", "target"]) {
  it.live(
    `refuses an accepted candidate after a ${location} SHA changes`,
    () =>
      Effect.gen(function* () {
        const state = yield* acceptedCandidate()
        const directory = location === "source" ? state.children[0]!.location.directory : state.target
        yield* Effect.promise(async () => {
          await Bun.write(path.join(directory, "later.txt"), "new contribution")
          await $`git add --all`.cwd(directory).quiet()
          await $`git commit -m later`.cwd(directory).quiet()
        })
        const response = yield* Effect.promise(() =>
          state.request(`${state.url}/apply`, {
            requestID: "stale-revision",
            revision: state.task.revision!,
            candidateHead: state.task.integration!.head,
          }),
        )
        expect(response.status).toBe(400)
        const todos = yield* SessionTodoStore.Service
        expect((yield* todos.get(state.parent.id))[2]?.integrationApplication).toBeUndefined()
        expect(yield* Effect.promise(() => Bun.file(path.join(state.target, "run.ts")).exists())).toBe(false)
      }),
    30_000,
  )
}
