import { describe, expect, test } from "bun:test"
import {
  THRESHOLDS,
  VAULT_TEST_NAME,
  evaluate,
  inScope,
  mergeCoverage,
  parseLcov,
  readThresholds,
  renderMarkdown,
  toLcov,
  uncoveredRanges,
  unloadedCoverage,
} from "./vault"

const root = "/repo"

// What Bun writes from packages/core: its own files, util's redact.ts through a relative path, and unrelated code.
const core = `TN:
SF:src/vault/vault.ts
FNF:4
FNH:2
DA:1,5
DA:2,0
DA:3,0
DA:5,1
DA:7,0
DA:9,0
LF:6
LH:2
end_of_record
TN:
SF:../util/src/redact.ts
FNF:2
FNH:1
DA:1,1
DA:2,0
DA:4,0
LF:3
LH:1
end_of_record
TN:
SF:src/session/prompt.ts
FNF:1
FNH:1
DA:1,1
LF:1
LH:1
end_of_record
`

// What Bun writes from packages/util, with a Windows separator.
const util = `TN:
SF:src\\redact.ts
FNF:2
FNH:2
DA:1,3
DA:2,4
DA:4,0
LF:3
LH:2
end_of_record
`

const unloadedSource = [
  "// Header comment",
  'import { x } from "y"',
  "",
  "export function a() {",
  "  return x",
  "}",
  "/**",
  " * doc",
  " */",
  "export const b = () => 2",
].join("\n")

function measured() {
  return mergeCoverage([
    ...parseLcov(core, `${root}/packages/core`, root),
    ...parseLcov(util, `${root}/packages/util`, root),
  ]).filter((file) => inScope(file.path))
}

describe("parseLcov", () => {
  test("makes every source path repository-relative and reads line and function totals", () => {
    const files = parseLcov(core, `${root}/packages/core`, root)
    expect(files.map((file) => file.path)).toEqual([
      "packages/core/src/vault/vault.ts",
      "packages/util/src/redact.ts",
      "packages/core/src/session/prompt.ts",
    ])
    expect([...(files[0]?.lines ?? [])]).toEqual([
      [1, 5],
      [2, 0],
      [3, 0],
      [5, 1],
      [7, 0],
      [9, 0],
    ])
    expect(files[0]?.functionsFound).toBe(4)
    expect(files[0]?.functionsHit).toBe(2)
    expect(files[0]?.loaded).toBe(true)
    expect(parseLcov(util, `${root}/packages/util`, root)[0]?.path).toBe("packages/util/src/redact.ts")
  })
})

describe("mergeCoverage", () => {
  test("keeps the highest hit count of each line across packages", () => {
    const files = mergeCoverage([
      ...parseLcov(core, `${root}/packages/core`, root),
      ...parseLcov(util, `${root}/packages/util`, root),
    ])
    expect(files.map((file) => file.path)).toEqual([
      "packages/core/src/session/prompt.ts",
      "packages/core/src/vault/vault.ts",
      "packages/util/src/redact.ts",
    ])
    const redact = files.find((file) => file.path === "packages/util/src/redact.ts")
    expect([...(redact?.lines ?? [])]).toEqual([
      [1, 3],
      [2, 4],
      [4, 0],
    ])
    expect(redact?.functionsFound).toBe(2)
    expect(redact?.functionsHit).toBe(2)
  })

  test("unions named functions so two partial runs can cover every function", () => {
    const run = (quote: number, expand: number) =>
      parseLcov(
        `SF:src/vault/shell.ts
FN:1,quote
FN:5,expand
FNDA:${quote},quote
FNDA:${expand},expand
FNF:2
FNH:1
DA:1,${quote}
DA:5,${expand}
end_of_record
`,
        `${root}/packages/core`,
        root,
      )
    const [file] = mergeCoverage([...run(2, 0), ...run(0, 1)])
    expect([...(file?.functions ?? [])]).toEqual([
      ["quote", 2],
      ["expand", 1],
    ])
    expect(file?.functionsHit).toBe(2)
    expect([...(file?.lines ?? [])]).toEqual([
      [1, 2],
      [5, 1],
    ])
  })
})

describe("inScope", () => {
  test("covers the vault surface, including new vault files, but never tests or neighbours", () => {
    expect(inScope("packages/core/src/vault/vault.ts")).toBe(true)
    expect(inScope("packages/core/src/vault/new-feature.ts")).toBe(true)
    expect(inScope("packages/core/src/vault/nested/deep.ts")).toBe(true)
    expect(inScope("packages/core/src/plugin/vault.ts")).toBe(true)
    expect(inScope("packages/core/src/tool/plugin/vault-request.ts")).toBe(true)
    expect(inScope("packages/cli/src/commands/handlers/vault/list.ts")).toBe(true)
    expect(inScope("packages/util/src/redact.ts")).toBe(true)
    expect(inScope("packages/tui/src/util/secret.ts")).toBe(true)
    expect(inScope("packages/util/src/redact.test.ts")).toBe(false)
    expect(inScope("packages/core/src/session/prompt.ts")).toBe(false)
    expect(inScope("packages/cli/src/commands/handlers/debug/redact.ts")).toBe(false)
  })

  test("discovers vault tests by name", () => {
    expect(VAULT_TEST_NAME.test("vault-shell.test.ts")).toBe(true)
    expect(VAULT_TEST_NAME.test("redact-find.test.ts")).toBe(true)
    expect(VAULT_TEST_NAME.test("secret.test.ts")).toBe(true)
    expect(VAULT_TEST_NAME.test("session-prompt.test.ts")).toBe(false)
  })
})

describe("unloadedCoverage", () => {
  test("counts every code line of a file no test imported as uncovered", () => {
    const file = unloadedCoverage("packages/cli/src/commands/handlers/vault/set.ts", unloadedSource)
    expect([...file.lines]).toEqual([
      [2, 0],
      [4, 0],
      [5, 0],
      [10, 0],
    ])
    expect(file.functionsFound).toBe(2)
    expect(file.functionsHit).toBe(0)
    expect(file.loaded).toBe(false)
  })
})

describe("evaluate", () => {
  test("groups uncovered lines across lines Bun does not report", () => {
    expect(
      uncoveredRanges(
        new Map([
          [1, 5],
          [2, 0],
          [3, 0],
          [5, 1],
          [7, 0],
          [9, 0],
        ]),
      ),
    ).toBe("2-3, 7-9")
    expect(uncoveredRanges(new Map([[1, 1]]))).toBe("")
  })

  test("fails on the totals and on each file below the per-file floor", () => {
    const report = evaluate(measured(), THRESHOLDS)
    expect(report.total).toEqual({ linesFound: 9, linesHit: 4, functionsFound: 6, functionsHit: 4 })
    expect(report.failures).toEqual([
      "Total line coverage 44.44% is below 90%",
      "Total function coverage 66.67% is below 90%",
      "packages/core/src/vault/vault.ts line coverage 33.33% is below 75%",
      "packages/util/src/redact.ts line coverage 66.67% is below 75%",
    ])
  })

  test("passes when every threshold is met", () => {
    expect(evaluate(measured(), { lines: 40, functions: 60, fileLines: 30 }).failures).toEqual([])
  })

  test("fails when nothing was measured", () => {
    expect(evaluate([], THRESHOLDS).failures).toEqual(["No vault files were measured"])
  })
})

describe("readThresholds", () => {
  test("defaults to the constants and accepts percentage overrides", () => {
    expect(readThresholds({})).toEqual(THRESHOLDS)
    expect(readThresholds({ REDCODE_VAULT_COVERAGE_LINES: "80", REDCODE_VAULT_COVERAGE_FILE_LINES: "" })).toEqual({
      lines: 80,
      functions: THRESHOLDS.functions,
      fileLines: THRESHOLDS.fileLines,
    })
  })

  test("rejects values that are not percentages", () => {
    expect(() => readThresholds({ REDCODE_VAULT_COVERAGE_FUNCTIONS: "high" })).toThrow("percentage")
    expect(() => readThresholds({ REDCODE_VAULT_COVERAGE_LINES: "101" })).toThrow("percentage")
  })
})

describe("output", () => {
  test("writes merged lcov that reads back to the same coverage", () => {
    const files = measured()
    expect(
      parseLcov(toLcov(files), root, root).map((file) => ({
        path: file.path,
        lines: [...file.lines],
        functionsFound: file.functionsFound,
        functionsHit: file.functionsHit,
      })),
    ).toEqual(
      files.map((file) => ({
        path: file.path,
        lines: [...file.lines].sort((a, b) => a[0] - b[0]),
        functionsFound: file.functionsFound,
        functionsHit: file.functionsHit,
      })),
    )
  })

  test("renders a row per file, marks unloaded files and lists the failures", () => {
    const files = mergeCoverage([
      ...measured(),
      unloadedCoverage("packages/cli/src/commands/handlers/vault/set.ts", unloadedSource),
    ])
    const markdown = renderMarkdown(evaluate(files, THRESHOLDS), THRESHOLDS)
    expect(markdown).toContain("| `packages/core/src/vault/vault.ts` | 33.33% (2/6) | 50.00% (2/4) | 2-3, 7-9 |")
    expect(markdown).toContain(
      "| `packages/cli/src/commands/handlers/vault/set.ts` | 0.00% (0/4) | 0.00% (0/2) | not loaded by any test |",
    )
    expect(markdown).toContain("| **Total** | **30.77% (4/13)** | **50.00% (4/8)** | |")
    expect(markdown).toContain("**Failed:**")
    expect(renderMarkdown(evaluate(measured(), { lines: 0, functions: 0, fileLines: 0 }), THRESHOLDS)).toContain(
      "**Passed.**",
    )
  })
})
