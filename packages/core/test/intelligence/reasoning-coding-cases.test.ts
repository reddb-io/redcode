import { describe, expect, test } from "bun:test"
import path from "node:path"
import { codingCases } from "../../script/reasoning-eval/coding-cases"
import { challengeCases } from "../../script/reasoning-eval/challenge-cases"
import { grade, prepare, snapshot, verify } from "../../script/reasoning-eval/coding"
import { tmpdir } from "../fixture/tmpdir"

test("coding corpus fixes twelve disjoint families before calibration", () => {
  expect(codingCases).toHaveLength(12)
  expect(new Set(codingCases.map((item) => item.id)).size).toBe(12)
  expect(new Set(codingCases.map((item) => item.family)).size).toBe(12)
  const calibration = codingCases.filter((item) => item.split === "calibration")
  const heldOut = codingCases.filter((item) => item.split === "held-out")
  expect(calibration).toHaveLength(6)
  expect(heldOut).toHaveLength(6)
  const tunedFamilies = new Set(calibration.map((item) => item.family))
  expect(heldOut.some((item) => tunedFamilies.has(item.family))).toBe(false)
  expect(new Set(codingCases.map((item) => item.category)).size).toBeGreaterThanOrEqual(8)
  codingCases.forEach((item) => {
    expect(Object.keys(item.files).toSorted()).toEqual(["package.json", "src.test.ts", "src.ts"])
    expect(item.editable).toEqual(["src.ts"])
    expect(item.checkIDs.length).toBeGreaterThan(1)
    expect(new Set(item.checkIDs).size).toBe(item.checkIDs.length)
    expect(Object.keys(item.reference)).toEqual(["src.ts"])
    expect(item.files["src.ts"]).not.toBe(item.reference["src.ts"])
    expect(item.prompt).toContain("Run bun run test")
    expect(item.prompt).not.toContain(item.reference["src.ts"])
    expect(item.prompt).not.toContain("REDCODE_EVAL_FIXTURE")
    expect(Object.values(item.files)).not.toContain(item.oracle)
  })
})

test("challenge families reserve a separate validation split without reusing the original corpus", () => {
  expect(challengeCases).toHaveLength(6)
  const original = new Set(codingCases.flatMap((item) => [item.id, item.family]))
  const calibration = challengeCases.filter((item) => item.split === "calibration")
  const reserved = challengeCases.filter((item) => item.split === "held-out")
  expect(calibration).toHaveLength(3)
  expect(reserved).toHaveLength(3)
  expect(new Set(challengeCases.map((item) => item.id)).size).toBe(6)
  expect(new Set(challengeCases.map((item) => item.family)).size).toBe(6)
  expect(challengeCases.some((item) => original.has(item.id) || original.has(item.family))).toBe(false)
  expect(reserved.some((item) => calibration.some((tuned) => tuned.family === item.family))).toBe(false)
  for (const item of challengeCases) {
    expect(new Set(item.checkIDs).size).toBe(item.checkIDs.length)
    expect(item.checkIDs.length).toBeGreaterThanOrEqual(5)
    expect(item.prompt).not.toContain(item.reference["src.ts"])
    expect(Object.values(item.files)).not.toContain(item.oracle)
  }
})

describe("independent coding oracles", () => {
  for (const item of [...codingCases, ...challengeCases]) {
    test(`${item.split}: ${item.id} rejects baseline and accepts reference edits`, async () => {
      await using temporary = await tmpdir("redcode-coding-corpus-")
      const directory = path.join(temporary.path, "fixture")
      const oracleDir = path.join(temporary.path, "hidden-oracle")
      await prepare(item, directory)
      const before = await snapshot(directory)
      expect(Object.keys(before)).toEqual(Object.keys(item.files).toSorted())
      const baseline = await verify(item, directory, oracleDir)
      expect(baseline.process.exit).toBe(0)
      expect(baseline.process.timedOut).toBe(false)
      expect(baseline.format).toBe(true)
      expect(baseline.pass).toBe(false)
      expect(baseline.checks.some((check) => !check.pass)).toBe(true)
      expect(baseline.checks.find((check) => check.id === "module-load")?.pass).toBe(true)
      expect(baseline.checks.map((check) => check.id)).toEqual([...item.checkIDs])
      expect(grade(item, before, before, baseline).failed).toContain("no_edit")
      expect(await snapshot(directory)).toEqual(before)

      await Promise.all(
        Object.entries(item.reference).map(([file, contents]) => Bun.write(path.join(directory, file), contents)),
      )
      const after = await snapshot(directory)
      const reference = await verify(item, directory, oracleDir)
      expect(reference.process.exit).toBe(0)
      expect(reference.process.timedOut).toBe(false)
      expect(reference.format).toBe(true)
      expect(reference.checks.every((check) => check.pass)).toBe(true)
      expect(reference.checks.map((check) => check.id)).toEqual([...item.checkIDs])
      expect(grade(item, before, after, reference)).toEqual({
        pass: true,
        score: 1,
        format: true,
        failed: [],
        changes: { added: [], modified: ["src.ts"], deleted: [] },
      })
      expect(await snapshot(directory)).toEqual(after)
      expect(after["package.json"]).toBe(before["package.json"])
      expect(after["src.test.ts"]).toBe(before["src.test.ts"])

      // Exercise the actual command shown to the agent, independently of hidden grading.
      const visible = Bun.spawn([process.execPath, "run", "test"], {
        cwd: directory,
        env: { PATH: process.env.PATH ?? "" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, exit] = await Promise.all([
        new Response(visible.stdout).text(),
        new Response(visible.stderr).text(),
        visible.exited,
      ])
      expect({ exit, stdout, stderr }).toMatchObject({ exit: 0 })
      expect(await snapshot(directory)).toEqual(after)
    }, 30_000)
  }

  test("import and evaluation exceptions still produce valid failing check reports", async () => {
    await using temporary = await tmpdir("redcode-coding-oracle-errors-")
    const directory = path.join(temporary.path, "fixture")
    const oracleDir = path.join(temporary.path, "hidden-oracle")
    const item = codingCases[0]
    await prepare(item, directory)
    for (const source of [
      "export const incomplete =",
      'throw new Error("module failed")\n',
      "export function overlaps() { throw new Error('execution failed') }\n",
    ]) {
      await Bun.write(path.join(directory, "src.ts"), source)
      const result = await verify(item, directory, oracleDir)
      expect(result.process.exit).toBe(0)
      expect(result.format).toBe(true)
      expect(result.pass).toBe(false)
      expect(result.checks.some((check) => !check.pass)).toBe(true)
      expect(new Set(result.checks.map((check) => check.id)).size).toBe(result.checks.length)
    }
  }, 30_000)

  test("async oracle accepts a valid sequential implementation as well as the concurrent reference", async () => {
    await using temporary = await tmpdir("redcode-coding-sequential-")
    const directory = path.join(temporary.path, "fixture")
    const item = codingCases.find((item) => item.id === "async-map-order")
    if (!item) throw new Error("Missing asynchronous ordering fixture")
    await prepare(item, directory)
    await Bun.write(
      path.join(directory, "src.ts"),
      `export async function mapOrdered<T, U>(items: readonly T[], work: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const result: U[] = []
  for (let index = 0; index < items.length; index++) result.push(await work(items[index], index))
  return result
}
`,
    )
    const result = await verify(item, directory, path.join(temporary.path, "hidden-oracle"))
    expect(result.process.exit).toBe(0)
    expect(result.pass).toBe(true)
    expect(result.failed).toEqual([])
  }, 30_000)
})
