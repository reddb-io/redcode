import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { TodoFold } from "../../../src/routes/session/todo-fold"

const model = { id: "model", providerID: "provider" }
const todo = (id: string, status: "completed" | "error", message = `refused ${id}`): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name: "todowrite",
  time: { created: 1, completed: 2 },
  state:
    status === "error"
      ? { status, input: {}, error: { type: "tool.execution", message } }
      : { status, input: {}, content: [{ type: "text", text: "ok" }], metadata: {} },
})
const shell = (id: string): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name: "shell",
  time: { created: 1, completed: 2 },
  state: { status: "completed", input: {}, content: [{ type: "text", text: "ok" }], metadata: {} },
})
const assistant = (id: string, content: SessionMessageAssistant["content"]): SessionMessageAssistant => ({
  type: "assistant",
  id,
  agent: "build",
  model,
  time: { created: 1, completed: 2 },
  content,
})
const user = (id: string): SessionMessageInfo => ({ type: "user", id, text: "go", time: { created: 1 } })

test("consecutive failures across assistant messages fold into one run led by the first", () => {
  const runs = TodoFold.fold([
    user("u"),
    assistant("a1", [todo("t1", "error")]),
    assistant("a2", [{ type: "reasoning", text: "retry" }, todo("t2", "error")]),
    assistant("a3", [{ type: "text", text: " " }, todo("t3", "error", "latest refusal\nmore detail")]),
  ])
  const run = runs.get("t1")
  expect(run?.lead).toBe("t1")
  expect(run?.count).toBe(3)
  expect(runs.get("t3")).toBe(run)
  expect(TodoFold.shown(run)).toBe(true)
  expect(TodoFold.label(run, todo("t1", "error"))).toBe("Todo update failed ×3: latest refusal")
  expect(TodoFold.errors(run?.parts ?? [])).toBe("1. refused t1\n\n2. refused t2\n\n3. latest refusal\nmore detail")
})

test("another tool, a user message or a success breaks a run", () => {
  const runs = TodoFold.fold([
    assistant("a1", [todo("t1", "error"), shell("s1"), todo("t2", "error")]),
    user("u"),
    assistant("a2", [todo("t3", "error"), todo("t4", "completed"), todo("t5", "error")]),
  ])
  expect(runs.get("t1")?.count).toBe(1)
  expect(runs.get("t2")?.count).toBe(1)
  expect(runs.get("t3")?.corrected).toBe(true)
  expect(runs.get("t5")?.lead).toBe("t5")
})

test("a single failure fixed on the next call is hidden; two are shown", () => {
  const single = TodoFold.fold([assistant("a", [todo("t1", "error"), todo("t2", "completed")])])
  expect(TodoFold.shown(single.get("t1"))).toBe(false)
  const double = TodoFold.fold([assistant("a", [todo("t1", "error"), todo("t2", "error"), todo("t3", "completed")])])
  expect(TodoFold.shown(double.get("t1"))).toBe(true)
  expect(TodoFold.label(undefined, todo("t9", "error", "alone"))).toBe("Todo update failed: alone")
})

test("the cached fold follows a finished message whose todowrite settles later", () => {
  const fold = TodoFold.createFold()
  const first = assistant("a1", [todo("t1", "error")])
  expect(fold([first]).get("t1")?.count).toBe(1)
  const grown = assistant("a1", [todo("t1", "error"), todo("t2", "error")])
  expect(fold([grown]).get("t1")?.count).toBe(2)
  const settled = assistant("a1", [todo("t1", "error"), todo("t2", "completed")])
  expect(fold([settled]).get("t1")?.corrected).toBe(true)
})

const semantic = (id: string) =>
  todo(
    id,
    "error",
    "todo_06c64b8b-0981-4281-8acf-465331bdaf06: Semantic evaluation needs_revision (2e493a75-079c-448c-95fb-99ee29d134fd): task_0_coverage (the task claims more than its selected requirement covers, or relies on truncated source text). Previous state preserved.",
  )

test("the collapsed label keeps the verdict and reason instead of the todo and review ids", () => {
  const call = semantic("t1")
  const label = TodoFold.label(TodoFold.fold([assistant("a", [call])]).get("t1"), call)
  expect(label).toContain("Todo update failed")
  expect(label).toContain("Semantic evaluation needs_revision: task_0_coverage")
  expect(label).toContain("claims more than its selected requirement covers")
  expect(label).not.toContain("todo_06c64b8b")
  expect(label).not.toContain("2e493a75")
  expect(label).not.toContain("Previous state preserved")
})

test("identical refusals in a run are shown once with a repeat count", () => {
  const parts = [semantic("t1"), semantic("t2"), semantic("t3"), semantic("t4")]
  const expanded = TodoFold.errors(parts)
  expect(expanded).toContain("×4")
  expect(expanded.match(/task_0_coverage/g)?.length).toBe(1)
  expect(TodoFold.errors([todo("t1", "error", "one"), todo("t2", "error", "one"), todo("t3", "error", "two")])).toBe(
    "1. one ×2\n\n2. two",
  )
})
