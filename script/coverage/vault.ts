#!/usr/bin/env bun

// Measures code coverage of the vault and secret-handling code and gates it. Each package that owns vault code
// runs its vault tests through its own `test` script with Bun's lcov coverage; the reports are merged (a line or
// function counts as covered when any run covered it), restricted to VAULT_SCOPE, and checked against THRESHOLDS.
// Scope files that no test imported are reported as 0% because Bun leaves unloaded files out of its report.
//
//   bun script/coverage/vault.ts [--out <dir>] [--package core|util|cli|tui ...] [--list]

import os from "node:os"
import path from "node:path"
import { appendFile, mkdir, rm } from "node:fs/promises"
import { parseArgs } from "node:util"

// Repository-relative globs of the vault surface. New files under the vault directories join automatically.
export const VAULT_SCOPE = [
  "packages/core/src/vault/**/*.ts",
  "packages/core/src/plugin/vault.ts",
  "packages/core/src/tool/plugin/vault-request.ts",
  "packages/util/src/redact.ts",
  "packages/cli/src/commands/handlers/vault/**/*.ts",
  "packages/tui/src/util/secret.ts",
]

// Every package that owns scope files, the directories its tests live in, and vault tests whose file names do
// not say so. Test files whose names match VAULT_TEST_NAME are discovered under the roots.
export const VAULT_TESTS = [
  {
    package: "core",
    roots: ["test"],
    extra: [
      "test/tool-shell.test.ts",
      "test/tool-write.test.ts",
      "test/session-prompt.test.ts",
      "test/session-compaction-restricted.test.ts",
    ],
  },
  { package: "util", roots: ["src", "test"], extra: [] },
  { package: "cli", roots: ["test"], extra: [] },
  { package: "tui", roots: ["test"], extra: [] },
]

export const VAULT_TEST_NAME = /vault|redact|secret/i

// Percentages. Override with REDCODE_VAULT_COVERAGE_LINES, _FUNCTIONS and _FILE_LINES for experiments.
export const THRESHOLDS = { lines: 90, functions: 90, fileLines: 75 }

export type Thresholds = typeof THRESHOLDS

export type FileCoverage = {
  path: string
  lines: Map<number, number>
  functions: Map<string, number>
  functionsFound: number
  functionsHit: number
  loaded: boolean
}

export type Report = ReturnType<typeof evaluate>

if (import.meta.main) await main()

async function main() {
  const args = parseArgs({
    options: {
      out: { type: "string", default: path.join(os.tmpdir(), "redcode-vault-coverage") },
      package: { type: "string", multiple: true },
      list: { type: "boolean", default: false },
    },
  }).values
  const root = path.resolve(import.meta.dir, "../..")
  const out = path.resolve(args.out)
  const thresholds = readThresholds(process.env)
  const suites = await Promise.all(
    selectSuites(args.package).map(async (suite) => ({
      package: suite.package,
      tests: await discoverTests(root, suite),
    })),
  )
  const scope = await scopeFiles(
    root,
    suites.map((suite) => suite.package),
  )
  if (args.list) {
    console.log(
      [
        ...suites.flatMap((suite) => suite.tests.map((file) => `test packages/${suite.package}/${file}`)),
        ...scope.map((file) => `scope ${file}`),
      ].join("\n"),
    )
    return
  }

  await mkdir(out, { recursive: true })
  // Packages run one after another to keep memory bounded, like script/test-redcode.ts.
  const runs = []
  for (const suite of suites) runs.push(await measurePackage(root, out, suite.package, suite.tests))

  const measured = mergeCoverage(runs.flatMap((run) => run.coverage)).filter((file) => scope.includes(file.path))
  const unloaded = await Promise.all(
    scope
      .filter((file) => !measured.some((entry) => entry.path === file))
      .map(async (file) => unloadedCoverage(file, await Bun.file(path.join(root, file)).text())),
  )
  const files = mergeCoverage([...measured, ...unloaded])
  const report = evaluate(files, thresholds)
  const failures = [
    ...runs.filter((run) => run.exit !== 0).map((run) => `${run.package} vault tests failed (exit ${run.exit})`),
    ...report.failures,
  ]
  const markdown = renderMarkdown({ ...report, failures }, thresholds)
  console.log(markdown)
  await Bun.write(path.join(out, "lcov.info"), toLcov(files))
  await Bun.write(path.join(out, "summary.md"), markdown)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown)
  if (failures.length > 0) process.exit(1)
}

function selectSuites(packages: string[] | undefined) {
  if (!packages) return VAULT_TESTS
  const unknown = packages.filter((name) => !VAULT_TESTS.some((suite) => suite.package === name))
  if (unknown.length > 0) throw new Error(`Unknown vault coverage package: ${unknown.join(", ")}`)
  return VAULT_TESTS.filter((suite) => packages.includes(suite.package))
}

async function discoverTests(root: string, suite: (typeof VAULT_TESTS)[number]) {
  const directory = path.join(root, "packages", suite.package)
  const scanned = await Promise.all(
    suite.roots.map((base) => Array.fromAsync(new Bun.Glob(`${base}/**/*.test.{ts,tsx}`).scan({ cwd: directory }))),
  )
  const named = scanned
    .flat()
    .map(posix)
    .filter((file) => VAULT_TEST_NAME.test(path.posix.basename(file)))
  if (named.length === 0)
    throw new Error(`No vault tests found in packages/${suite.package} (${suite.roots.join(", ")})`)
  const missing = (
    await Promise.all(
      suite.extra.map(async (file) => ((await Bun.file(path.join(directory, file)).exists()) ? [] : [file])),
    )
  ).flat()
  if (missing.length > 0) throw new Error(`Missing vault tests in packages/${suite.package}: ${missing.join(", ")}`)
  return [...new Set([...named, ...suite.extra])].sort()
}

async function scopeFiles(root: string, packages: string[]) {
  const scanned = await Promise.all(
    VAULT_SCOPE.map((pattern) => Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: root }))),
  )
  const files = [...new Set(scanned.flat().map(posix))]
    .filter((file) => inScope(file))
    .filter((file) => packages.some((name) => file.startsWith(`packages/${name}/`)))
    .sort()
  if (files.length === 0) throw new Error(`No vault scope files found for ${packages.join(", ")}`)
  return files
}

// Runs through the package's own `test` script so each package keeps its preload, timeout and sandboxed home.
async function measurePackage(root: string, out: string, name: string, tests: string[]) {
  const directory = path.join(root, "packages", name)
  const reports = path.join(out, name)
  await rm(reports, { recursive: true, force: true })
  console.log(`${name}: measuring ${tests.length} vault test files`)
  const exit = await Bun.spawn(
    [process.execPath, "run", "test", "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${reports}`, ...tests],
    {
      cwd: directory,
      env: { ...process.env, GITHUB_ACTIONS: "false" },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  ).exited
  const lcov = Bun.file(path.join(reports, "lcov.info"))
  if (!(await lcov.exists())) throw new Error(`${name}: Bun wrote no lcov report to ${reports} (exit ${exit})`)
  return { package: name, exit, coverage: parseLcov(await lcov.text(), directory, root) }
}

// Bun writes source paths relative to the directory the tests ran in, so a core run reports util's redact.ts as
// ../util/src/redact.ts. Every path becomes repository-relative with forward slashes before runs are merged.
export function parseLcov(text: string, directory: string, root: string) {
  return text
    .split(/^end_of_record\s*$/m)
    .map((record) =>
      record
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes(":"))
        .map((line) => ({ key: line.slice(0, line.indexOf(":")), value: line.slice(line.indexOf(":") + 1) })),
    )
    .flatMap((fields) => {
      const source = fields.find((field) => field.key === "SF")
      if (!source) return []
      const values = (key: string) => fields.filter((field) => field.key === key).map((field) => pair(field.value))
      const count = (key: string) => Number(fields.find((field) => field.key === key)?.value ?? 0)
      const hits = new Map(values("FNDA").map((entry) => [entry.rest, Number(entry.first)]))
      const functions = new Map(
        [...values("FN"), ...values("FNDA")].map((entry) => [entry.rest, hits.get(entry.rest) ?? 0]),
      )
      return [
        {
          path: posix(path.relative(root, path.resolve(directory, source.value.replaceAll("\\", "/")))),
          lines: new Map(values("DA").map((entry) => [Number(entry.first), Number(entry.rest.split(",")[0])])),
          functions,
          functionsFound: Math.max(count("FNF"), functions.size),
          functionsHit: Math.max(count("FNH"), [...functions.values()].filter((hit) => hit > 0).length),
          loaded: true,
        },
      ]
    })
}

// Line and named-function hits take the maximum across runs. Bun 1.4 reports only function totals (FNF/FNH),
// so without names the merged function coverage is the best single run: a lower bound, never an overstatement.
export function mergeCoverage(files: FileCoverage[]) {
  const merged = files.reduce((result, file) => {
    const previous = result.get(file.path)
    if (!previous) return result.set(file.path, file)
    const functions = mergeHits(previous.functions, file.functions)
    return result.set(file.path, {
      path: file.path,
      lines: mergeHits(previous.lines, file.lines),
      functions,
      functionsFound: Math.max(previous.functionsFound, file.functionsFound, functions.size),
      functionsHit: Math.max(
        previous.functionsHit,
        file.functionsHit,
        [...functions.values()].filter((hit) => hit > 0).length,
      ),
      loaded: previous.loaded || file.loaded,
    })
  }, new Map<string, FileCoverage>())
  return [...merged.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export function inScope(file: string, scope = VAULT_SCOPE) {
  return !/\.test\.tsx?$/.test(file) && scope.some((pattern) => new Bun.Glob(pattern).match(file))
}

// Estimates a file no test imported: every line that is not blank, a comment or closing punctuation counts as
// uncovered, and each `function` keyword or arrow counts as an uncovered function.
export function unloadedCoverage(file: string, source: string): FileCoverage {
  return {
    path: file,
    lines: new Map(
      source.split(/\r?\n/).flatMap((line, index) => {
        const code = line.trim()
        if (code === "" || /^(\/\/|\/\*|\*|[)\]}]+[;,)]*$)/.test(code)) return []
        return [[index + 1, 0] as const]
      }),
    ),
    functions: new Map(),
    functionsFound: Math.max(1, source.match(/\bfunction\b|=>/g)?.length ?? 0),
    functionsHit: 0,
    loaded: false,
  }
}

export function evaluate(files: FileCoverage[], thresholds: Thresholds) {
  const rows = files.map((file) => ({
    path: file.path,
    loaded: file.loaded,
    linesFound: file.lines.size,
    linesHit: [...file.lines.values()].filter((hit) => hit > 0).length,
    functionsFound: file.functionsFound,
    functionsHit: file.functionsHit,
    uncovered: uncoveredRanges(file.lines),
  }))
  const total = {
    linesFound: rows.reduce((sum, row) => sum + row.linesFound, 0),
    linesHit: rows.reduce((sum, row) => sum + row.linesHit, 0),
    functionsFound: rows.reduce((sum, row) => sum + row.functionsFound, 0),
    functionsHit: rows.reduce((sum, row) => sum + row.functionsHit, 0),
  }
  const lines = percent(total.linesHit, total.linesFound)
  const functions = percent(total.functionsHit, total.functionsFound)
  const failures = [
    ...(rows.length === 0 ? ["No vault files were measured"] : []),
    ...(lines < thresholds.lines ? [`Total line coverage ${format(lines)} is below ${thresholds.lines}%`] : []),
    ...(functions < thresholds.functions
      ? [`Total function coverage ${format(functions)} is below ${thresholds.functions}%`]
      : []),
    ...rows
      .filter((row) => percent(row.linesHit, row.linesFound) < thresholds.fileLines)
      .map(
        (row) =>
          `${row.path} line coverage ${format(percent(row.linesHit, row.linesFound))} is below ${thresholds.fileLines}%`,
      ),
  ]
  return { rows, total, failures }
}

// Groups consecutive uncovered lines among the lines Bun reports, so blank lines do not split a range.
export function uncoveredRanges(lines: Map<number, number>) {
  return [...lines]
    .sort((a, b) => a[0] - b[0])
    .reduce<number[][]>((result, entry, index, entries) => {
      if (entry[1] > 0) return result
      if (entries[index - 1]?.[1] === 0) return [...result.slice(0, -1), [...(result.at(-1) ?? []), entry[0]]]
      return [...result, [entry[0]]]
    }, [])
    .map((run) => (run.length === 1 ? `${run[0]}` : `${run[0]}-${run.at(-1)}`))
    .join(", ")
}

export function renderMarkdown(report: Report, thresholds: Thresholds) {
  return [
    "### Vault coverage",
    "",
    "| File | Lines | Functions | Uncovered lines |",
    "| --- | ---: | ---: | --- |",
    ...report.rows.map(
      (row) =>
        `| \`${row.path}\` | ${ratio(row.linesHit, row.linesFound)} | ${ratio(row.functionsHit, row.functionsFound)} | ${row.loaded ? row.uncovered : "not loaded by any test"} |`,
    ),
    `| **Total** | **${ratio(report.total.linesHit, report.total.linesFound)}** | **${ratio(report.total.functionsHit, report.total.functionsFound)}** | |`,
    "",
    `Thresholds: total lines ${thresholds.lines}%, total functions ${thresholds.functions}%, each file's lines ${thresholds.fileLines}%.`,
    "",
    ...(report.failures.length === 0
      ? ["**Passed.**"]
      : ["**Failed:**", ...report.failures.map((line) => `- ${line}`)]),
    "",
  ].join("\n")
}

export function toLcov(files: FileCoverage[]) {
  return files
    .map((file) =>
      [
        "TN:",
        `SF:${file.path}`,
        `FNF:${file.functionsFound}`,
        `FNH:${file.functionsHit}`,
        ...[...file.lines].sort((a, b) => a[0] - b[0]).map((entry) => `DA:${entry[0]},${entry[1]}`),
        `LF:${file.lines.size}`,
        `LH:${[...file.lines.values()].filter((hit) => hit > 0).length}`,
        "end_of_record",
      ].join("\n"),
    )
    .join("\n")
    .concat("\n")
}

export function readThresholds(env: Record<string, string | undefined>) {
  return {
    lines: threshold(env.REDCODE_VAULT_COVERAGE_LINES, THRESHOLDS.lines),
    functions: threshold(env.REDCODE_VAULT_COVERAGE_FUNCTIONS, THRESHOLDS.functions),
    fileLines: threshold(env.REDCODE_VAULT_COVERAGE_FILE_LINES, THRESHOLDS.fileLines),
  }
}

function threshold(value: string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100)
    throw new Error(`A vault coverage threshold must be a percentage from 0 to 100, got ${value}`)
  return parsed
}

function mergeHits<Key>(a: Map<Key, number>, b: Map<Key, number>) {
  return new Map([...a.keys(), ...b.keys()].map((key) => [key, Math.max(a.get(key) ?? 0, b.get(key) ?? 0)]))
}

// Splits an lcov value such as `12,3` or `3,name` at its first comma.
function pair(value: string) {
  return { first: value.slice(0, value.indexOf(",")), rest: value.slice(value.indexOf(",") + 1) }
}

function percent(hit: number, found: number) {
  return found === 0 ? 100 : (hit / found) * 100
}

function format(value: number) {
  return `${value.toFixed(2)}%`
}

function ratio(hit: number, found: number) {
  return `${format(percent(hit, found))} (${hit}/${found})`
}

function posix(file: string) {
  return file.split(path.sep).join("/")
}
