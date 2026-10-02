import { expect, test } from "bun:test"
import { mkdir, rm, utimes } from "node:fs/promises"
import path from "node:path"
import type { CodingCase } from "../../script/reasoning-eval/coding-cases"
import { grade, prepare, snapshot, verify } from "../../script/reasoning-eval/coding"
import { tmpdir } from "../fixture/tmpdir"

const fixture: CodingCase = {
  id: "nested-integer-total",
  family: "integer-arithmetic",
  split: "calibration",
  category: "coding",
  prompt: "Fix the tax rounding in src/total.ts; preserve the tests and package metadata.",
  files: {
    "src/total.ts": "export const total = (price: number, count: number, rate: number) => price * count * (1 + rate)\n",
    "src/total.test.ts": "// Visible test fixture; the hidden oracle is independent.\n",
    "package.json": '{"scripts":{"test":"bun test"}}\n',
  },
  editable: ["src/total.ts"],
  checkIDs: ["rounded-tax", "zero-total"],
  oracle: `import path from "node:path"
import { pathToFileURL } from "node:url"
const { total } = await import(pathToFileURL(path.join(process.env.REDCODE_EVAL_FIXTURE, "src/total.ts")).href)
console.log(JSON.stringify({ checks: [
  { id: "rounded-tax", pass: total(1999, 3, 0.2) === 7196 },
  { id: "zero-total", pass: total(0, 3, 0.2) === 0 },
] }))
console.error("oracle diagnostic")
`,
  reference: {
    "src/total.ts":
      "export const total = (price: number, count: number, rate: number) => price * count + Math.round(price * count * rate)\n",
  },
}

test("executes an independent oracle against the baseline and reference edit with process metrics", async () => {
  await using tmp = await tmpdir("reasoning-coding-")
  const directory = path.join(tmp.path, "candidate")
  const oracles = path.join(tmp.path, "hidden")
  await prepare(fixture, directory)
  const before = await snapshot(directory)
  expect(Object.keys(before)).toEqual(["package.json", "src/total.test.ts", "src/total.ts"])
  expect(Object.values(before).every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true)
  const baseline = await verify(fixture, directory, oracles)
  expect(baseline).toMatchObject({ pass: false, score: 0.5, format: true, failed: ["rounded-tax"] })
  expect(baseline.process).toMatchObject({ exit: 0, timedOut: false })
  expect(baseline.process.durationMs).toBeGreaterThan(0)
  expect(baseline.process.stdoutBytes).toBeGreaterThan(0)
  expect(baseline.process.stderrBytes).toBe(Buffer.byteLength("oracle diagnostic\n"))
  expect(grade(fixture, before, before, baseline).failed).toContain("no_edit")

  await Bun.write(path.join(directory, "src/total.ts"), fixture.reference["src/total.ts"]!)
  const result = await verify(fixture, directory, oracles)
  expect(result.pass).toBe(true)
  expect(grade(fixture, before, await snapshot(directory), result)).toEqual({
    pass: true,
    score: 1,
    format: true,
    failed: [],
    changes: { added: [], modified: ["src/total.ts"], deleted: [] },
  })
  expect(Object.keys(await snapshot(directory))).toEqual(Object.keys(before))
  expect(await snapshot(oracles)).toEqual({})
})

test("resets nested fixture bytes and removes artifacts before every execution", async () => {
  await using tmp = await tmpdir("reasoning-coding-reset-")
  const directory = path.join(tmp.path, "candidate")
  await prepare(fixture, directory)
  const before = await snapshot(directory)
  await Bun.write(path.join(directory, "src/total.ts"), fixture.reference["src/total.ts"]!)
  await mkdir(path.join(directory, "build"))
  await Bun.write(path.join(directory, "build/generated.txt"), "left over from the previous run")
  await rm(path.join(directory, "src/total.test.ts"))
  expect(await snapshot(directory)).not.toEqual(before)
  await prepare(fixture, directory)
  expect(await snapshot(directory)).toEqual(before)
  expect(await Bun.file(path.join(directory, "src/total.ts")).text()).toBe(fixture.files["src/total.ts"]!)
  expect(await Bun.file(path.join(directory, "build/generated.txt")).exists()).toBe(false)
})

test("hashes contents rather than timestamps and includes dotfiles and binary files", async () => {
  await using tmp = await tmpdir("reasoning-coding-hash-")
  const directory = path.join(tmp.path, "candidate")
  await prepare(fixture, directory)
  await Bun.write(path.join(directory, ".hidden"), "abc")
  await Bun.write(path.join(directory, "bytes.bin"), new Uint8Array([0, 255, 128, 10]))
  const before = await snapshot(directory)
  expect(before[".hidden"]).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  expect(before["bytes.bin"]).toMatch(/^[0-9a-f]{64}$/)
  await utimes(path.join(directory, "src/total.ts"), new Date(0), new Date(0))
  expect(await snapshot(directory)).toEqual(before)
  await Bun.write(path.join(directory, "bytes.bin"), new Uint8Array([0, 254, 128, 10]))
  expect((await snapshot(directory))["bytes.bin"]).not.toBe(before["bytes.bin"])
})

for (const tampering of ["modify-test", "delete-test", "new-file", "node-modules"] as const) {
  test(`rejects ${tampering} even when the original hidden oracle passes`, async () => {
    await using tmp = await tmpdir("reasoning-coding-scope-")
    const directory = path.join(tmp.path, "candidate")
    await prepare(fixture, directory)
    const before = await snapshot(directory)
    await Bun.write(path.join(directory, "src/total.ts"), fixture.reference["src/total.ts"]!)
    if (tampering === "modify-test") await Bun.write(path.join(directory, "src/total.test.ts"), "// all tests pass\n")
    if (tampering === "delete-test") await rm(path.join(directory, "src/total.test.ts"))
    if (tampering === "new-file") await Bun.write(path.join(directory, "new.ts"), "export const unrelated = true\n")
    if (tampering === "node-modules") {
      await mkdir(path.join(directory, "node_modules"))
      await Bun.write(path.join(directory, "node_modules/extra.js"), "module.exports = true\n")
    }
    const verification = await verify(fixture, directory, path.join(tmp.path, "hidden"))
    expect(verification.pass).toBe(true)
    const result = grade(fixture, before, await snapshot(directory), verification)
    expect(result.pass).toBe(false)
    expect(result.score).toBe(0)
    expect(result.failed).toEqual([
      `out_of_scope:${tampering === "node-modules" ? "node_modules/extra.js" : tampering === "new-file" ? "new.ts" : "src/total.test.ts"}`,
    ])
    if (tampering === "delete-test") expect(result.changes.deleted).toEqual(["src/total.test.ts"])
  })
}

test("runs outside the candidate with an explicitly isolated home environment", async () => {
  await using tmp = await tmpdir("reasoning-coding-env-")
  const directory = path.join(tmp.path, "candidate")
  await prepare(fixture, directory)
  const result = await verify(
    {
      ...fixture,
      checkIDs: ["outside", "isolated-home", "path"],
      oracle: `import path from "node:path"
console.log(JSON.stringify({checks:[
  {id:"outside",pass:path.resolve(process.cwd()) !== path.resolve(process.env.REDCODE_EVAL_FIXTURE)},
  {id:"isolated-home",pass:path.resolve(process.env.HOME) === process.cwd() && path.resolve(process.env.USERPROFILE) === process.cwd()},
  {id:"path",pass:typeof process.env.PATH === "string"},
]}))`,
    },
    directory,
    path.join(tmp.path, "hidden"),
  )
  expect(result).toMatchObject({ pass: true, failed: [] })
})

test("a successful oracle without an editable change still fails the final grade", async () => {
  await using tmp = await tmpdir("reasoning-coding-no-edit-")
  const directory = path.join(tmp.path, "candidate")
  await prepare({ ...fixture, files: { ...fixture.files, ...fixture.reference } }, directory)
  const before = await snapshot(directory)
  const verification = await verify(fixture, directory, path.join(tmp.path, "hidden"))
  expect(verification.pass).toBe(true)
  expect(grade(fixture, before, await snapshot(directory), verification)).toMatchObject({
    pass: false,
    score: 0,
    failed: ["no_edit"],
  })
})

test("retains actual exit and UTF-8 byte counts, refusing success JSON from a failed process", async () => {
  await using tmp = await tmpdir("reasoning-coding-exit-")
  const directory = path.join(tmp.path, "candidate")
  await prepare(fixture, directory)
  const output = JSON.stringify({ checks: [{ id: "result", pass: true }] })
  const result = await verify(
    {
      ...fixture,
      checkIDs: ["result"],
      oracle: `console.log(${JSON.stringify(output)}); console.error("β"); process.exit(7)`,
    },
    directory,
    path.join(tmp.path, "hidden"),
  )
  expect(result).toMatchObject({ pass: false, score: 0, format: true, failed: ["oracle_incomplete", "oracle_exit"] })
  expect(result.process).toMatchObject({
    exit: 7,
    stdoutBytes: Buffer.byteLength(`${output}\n`),
    stderrBytes: 3,
    timedOut: false,
  })
})

for (const output of [
  "not JSON",
  '{"checks":[]}',
  '{"checks":[{"id":"same","pass":true},{"id":"same","pass":true}]}',
]) {
  test(`rejects invalid oracle output: ${output}`, async () => {
    await using tmp = await tmpdir("reasoning-coding-format-")
    const directory = path.join(tmp.path, "candidate")
    await prepare(fixture, directory)
    const result = await verify(
      { ...fixture, oracle: `console.log(${JSON.stringify(output)})` },
      directory,
      path.join(tmp.path, "hidden"),
    )
    expect(result).toMatchObject({ pass: false, score: 0, format: false, failed: ["oracle_format"], checks: [] })
    expect(result.process.exit).toBe(0)
  })
}

for (const checks of [
  [{ id: "unknown", pass: true }],
  [{ id: "rounded-tax", pass: true }],
  [
    { id: "rounded-tax", pass: true },
    { id: "zero-total", pass: true },
    { id: "unexpected", pass: true },
  ],
]) {
  test(`rejects a completed oracle with a mismatched check set: ${checks.map((check) => check.id).join(", ")}`, async () => {
    await using tmp = await tmpdir("reasoning-coding-checks-")
    const directory = path.join(tmp.path, "candidate")
    await prepare(fixture, directory)
    const result = await verify(
      { ...fixture, oracle: `console.log(${JSON.stringify(JSON.stringify({ checks }))})` },
      directory,
      path.join(tmp.path, "hidden"),
    )
    expect(result).toMatchObject({ pass: false, score: 0, format: true, failed: ["oracle_checks"] })
    expect(result.process.exit).toBe(0)
  })
}

for (const forgedReport of [false, true]) {
  test(`candidate early exit 0 cannot replace the hidden oracle${forgedReport ? " with forged success JSON" : ""}`, async () => {
    await using tmp = await tmpdir("reasoning-coding-early-exit-")
    const directory = path.join(tmp.path, "candidate")
    await prepare(fixture, directory)
    const before = await snapshot(directory)
    const output = JSON.stringify({ checks: fixture.checkIDs.map((id) => ({ id, pass: true })) })
    await Bun.write(
      path.join(directory, "src/total.ts"),
      `${forgedReport ? `console.log(${JSON.stringify(output)});` : ""} process.exit(0)\n`,
    )
    const verification = await verify(fixture, directory, path.join(tmp.path, "hidden"))
    expect(verification.process.exit).toBe(0)
    expect(verification.pass).toBe(false)
    expect(verification.score).toBe(0)
    expect(verification.failed).toContain("oracle_incomplete")
    expect(verification.format).toBe(forgedReport)
    expect(grade(fixture, before, await snapshot(directory), verification).pass).toBe(false)
  })
}

test("candidate console logging remains diagnostic output and cannot replace the final report", async () => {
  await using tmp = await tmpdir("reasoning-coding-logging-")
  const directory = path.join(tmp.path, "candidate")
  await prepare(fixture, directory)
  const before = await snapshot(directory)
  await Bun.write(
    path.join(directory, "src/total.ts"),
    `console.log("candidate loaded")
console.log(JSON.stringify({ checks: [{ id: "fake", pass: false }] }))
export function total(price: number, count: number, rate: number) {
  console.log("candidate invocation")
  return price * count + Math.round(price * count * rate)
}
`,
  )
  const verification = await verify(fixture, directory, path.join(tmp.path, "hidden"))
  expect(verification).toMatchObject({ pass: true, score: 1, format: true, failed: [] })
  expect(verification.checks.map((check) => check.id)).toEqual([...fixture.checkIDs])
  expect(verification.process.stdoutBytes).toBeGreaterThan(Buffer.byteLength("candidate loaded\n"))
  expect(grade(fixture, before, await snapshot(directory), verification).pass).toBe(true)
})

test("kills a hung real oracle within a bounded timeout and reports the timeout", async () => {
  await using tmp = await tmpdir("reasoning-coding-timeout-")
  const directory = path.join(tmp.path, "candidate")
  await prepare(fixture, directory)
  const result = await verify(
    { ...fixture, oracle: "setInterval(() => {}, 1000); await new Promise(() => {})" },
    directory,
    path.join(tmp.path, "hidden"),
    { timeoutMs: 100 },
  )
  expect(result.pass).toBe(false)
  expect(result.score).toBe(0)
  expect(result.failed).toContain("oracle_timeout")
  expect(result.process.timedOut).toBe(true)
  expect(result.process.exit).not.toBe(0)
  expect(result.process.durationMs).toBeLessThan(5_000)
})

test("refuses unsafe fixture paths before resetting existing files or writing outside", async () => {
  await using tmp = await tmpdir("reasoning-coding-paths-")
  const directory = path.join(tmp.path, "candidate")
  await prepare(fixture, directory)
  const before = await snapshot(directory)
  for (const file of ["../escape.ts", "/absolute.ts", "C:/absolute.ts", "src/../escape.ts", "src\\escape.ts", ""]) {
    await expect(prepare({ ...fixture, files: { ...fixture.files, [file]: "unsafe" } }, directory)).rejects.toThrow(
      "Invalid fixture path",
    )
    expect(await snapshot(directory)).toEqual(before)
  }
  expect(await Bun.file(path.join(tmp.path, "escape.ts")).exists()).toBe(false)
})

test("refuses an oracle inside the agent fixture and invalid time limits", async () => {
  await using tmp = await tmpdir("reasoning-coding-oracle-path-")
  const directory = path.join(tmp.path, "candidate")
  await prepare(fixture, directory)
  const before = await snapshot(directory)
  await expect(verify(fixture, directory, directory)).rejects.toThrow("Oracle directory must be outside")
  await expect(verify(fixture, directory, path.join(directory, "hidden"))).rejects.toThrow(
    "Oracle directory must be outside",
  )
  await expect(verify(fixture, directory, path.join(tmp.path, "hidden"), { timeoutMs: 0 })).rejects.toThrow(
    "Oracle timeout",
  )
  expect(await snapshot(directory)).toEqual(before)
})
