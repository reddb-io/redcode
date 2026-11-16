import { expect, test } from "bun:test"
import { SessionPlan } from "@opencode/core/session/plan"

const plan = (content: string, tasks: any[]) => ({ content, tasks }) as Pick<SessionPlan.Info, "content" | "tasks">

const planContent = [
  "# Candinator",
  "Speed up typing by 20%.",
  "Fix the flicker when the drawer opens.",
].join("\n")

const task = (overrides: Record<string, unknown> = {}) => ({
  key: "typing",
  content: "Lower the typing delays",
  criterion: "humanType uses the new delays",
  quote: "Speed up typing by 20%.",
  ...overrides,
})

test("a complete task set passes", () => {
  // The validator returns the graph problem, or nothing when the tasks are sound.
  expect(SessionPlan.validationError(plan(planContent, [task()]))).toBeUndefined()
})

test("a quote copied from the plan is accepted; one from the user request is named with what is missing", () => {
  const refused = SessionPlan.validationError(
    plan(planContent, [task({ quote: "faz uns testes ai e eu te dar o feedback" })]),
  )!
  // The refusal names the task and the offending quote instead of repeating one generic line.
  expect(refused).toContain("typing")
  expect(refused).toContain("does not appear in the plan content")
  expect(refused).toContain("faz uns testes ai")
})

test("each missing field is reported by name and task", () => {
  expect(SessionPlan.validationError(plan(planContent, [task({ criterion: " " })]))).toContain(
    "typing needs an acceptance criterion",
  )
  expect(SessionPlan.validationError(plan(planContent, [task({ key: "" })]))).toContain("needs a key")
  expect(SessionPlan.validationError(plan(planContent, [task({ content: "" })]))).toContain("needs content")
  expect(SessionPlan.validationError(plan(planContent, [task({ quote: "" })]))).toContain(
    "needs a quote copied verbatim",
  )
})

test("an empty plan is refused before its tasks", () => {
  expect(SessionPlan.validationError(plan("   ", [task()]))).toBe("The plan is empty")
})
