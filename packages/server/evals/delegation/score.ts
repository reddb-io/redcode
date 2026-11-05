import { z } from "zod"

const Name = z.enum(["delegate_task", "task_status", "task_cancel", "thread_create", "orchestrator_capabilities"])
const Action = z.object({ name: Name, target: z.enum(["redcode", "codex", "claude"]).optional() }).strict()
const Case = z.object({ id: z.string().min(1), prompt: z.string().min(1), expected: z.array(Action) }).strict()
const Observation = z.object({ id: z.string().min(1), actions: z.array(Action) }).strict()

export function score(cases: unknown, observations: unknown) {
  const expected = z.array(Case).min(1).parse(cases)
  const actual = z.array(Observation).parse(observations)
  const uniqueCases = new Set(expected.map((item) => item.id))
  if (uniqueCases.size !== expected.length) throw new Error("Duplicate case ID")
  const results = new Map(actual.map((item) => [item.id, item.actions]))
  if (results.size !== actual.length) throw new Error("Duplicate observation ID")
  const unknown = actual.filter((item) => !uniqueCases.has(item.id)).map((item) => item.id)
  if (unknown.length) throw new Error(`Unknown observation IDs: ${unknown.join(", ")}`)
  const entries = expected.map((item) => {
    const actions = results.get(item.id)
    const normalize = (items: z.infer<typeof Action>[]) =>
      items.map((action) => `${action.name}:${action.target ?? ""}`).toSorted()
    const passed =
      actions !== undefined && JSON.stringify(normalize(actions)) === JSON.stringify(normalize(item.expected))
    return { id: item.id, expected: item.expected, observed: actions ?? null, passed }
  })
  return { total: entries.length, passed: entries.filter((entry) => entry.passed).length, entries }
}

if (import.meta.main) {
  const file = process.argv[2]
  if (!file) throw new Error("Usage: bun evals/delegation/score.ts <observations.json>")
  const cases = await Bun.file(new URL("./cases.json", import.meta.url)).json()
  const result = score(cases, await Bun.file(file).json())
  console.log(JSON.stringify(result, null, 2))
  if (result.passed !== result.total) process.exitCode = 1
}
