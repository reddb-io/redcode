import { expect, test } from "bun:test"
import path from "node:path"
import { DesignFiles } from "@opencode/core/design/files"
import { DesignLint } from "@opencode/core/design/lint"
import { DesignQuality } from "@opencode/core/design/quality"
import { DesignReuse } from "@opencode/core/design/reuse"
import { tmpdir } from "./fixture/tmpdir"

const sheet = ":root {\n  --brand: #336699;\n  --danger: #ff0000;\n  --overlay: #33669980;\n}"
const sources = [
  { file: "styles/palette.css", hash: DesignFiles.hash(sheet), excerpt: sheet, observed: 1, authoritative: false },
]
const lint = (text: string, file = "src/main.css") =>
  DesignLint.check({ files: [{ file, text }], sources, width: 1440 })

test("matches project CSS tokens with file, line and hash evidence while retaining alpha", () => {
  const checks = lint(`.a { color: #336699; background-color: #33669980; border-color: #ff0000; }
.b { color: #33669940; background: #123456; color: var(--brand); }
:root { --custom: #336699; }`)
  expect(checks).toHaveLength(3)
  expect(checks.every((check) => check.rule === "design/prefer-color-token" && check.severity === "review")).toBe(true)
  expect(checks[0]!.evidence).toContain(`--brand in styles/palette.css:2 (sha256 ${sources[0]!.hash})`)
  expect(checks[1]!.fix).toContain("var(--overlay)")
  expect(checks[2]!.fix).toContain("var(--danger)")
  expect(
    DesignLint.check({ files: [{ file: "main.css", text: ".a {color:#336699}" }], sources: [], width: 0 }),
  ).toEqual([])
})

test("reviews solid heights as possible clipping, without imposing project theme or RTL conventions", () => {
  const checks = lint(`.a { line-height: 1; }
.b { line-height: 1.00 !important; }
.c { line-height: 100%; }
.d { line-height: 1em; }
.e { line-height: var(--leading); line-height: 1.2; left: 0; text-align: left; }
.dark { color: var(--brand); }`)
  expect(checks).toHaveLength(4)
  expect(checks.map((check) => check.selector)).toEqual([1, 2, 3, 4].map((line) => `source src/main.css:${line}`))
  expect(checks.every((check) => check.rule === "design/no-solid-line-height")).toBe(true)
  expect(checks[0]!.evidence).toContain("can clip")
})

test("normalization keeps space-separated color channels distinct", () => {
  const checks = DesignLint.check({
    files: [{ file: "main.css", text: ".a {color:rgb(12 3 45); background:rgb( 1 23 45 );}" }],
    sources: [{ ...sources[0]!, excerpt: ":root {--brand: rgb(1 23 45);}" }],
    width: 1440,
  })
  expect(checks).toHaveLength(1)
  expect(checks[0]!.evidence).toStartWith("background:")
})

test("comments, strings, URLs, nested functions and incomplete excerpts are not declarations", () => {
  expect(
    lint(`/* .a { color: #336699; line-height: 1; } */
.a { content: "/* not a comment */ color: #336699; line-height: 1;";
background-image: url("data:image/svg+xml;<svg fill='#336699'>{}</svg>");
color: var(--brand, #336699); line-height: calc(1 + 0.2); }
.b { color: #3366`),
  ).toEqual([])
})

test("reads real style blocks with original CRLF line offsets, not script strings, comments or JSX", () => {
  const text = `<!-- <style>.a {line-height: 1}</style> -->\r\n<script>const example = "<style>.a {color: #336699}</style>";</script>\r\n<style>\r\n.a {color: #336699;}\r\n.b {line-height: 1;}\r\n</style>`
  for (const file of ["index.html", "View.vue", "View.svelte"]) {
    expect(lint(text, file).map((check) => check.selector)).toEqual([`source ${file}:4`, `source ${file}:5`])
  }
  expect(lint(`const copy = 'color: #336699; line-height: 1;'`, "main.tsx")).toEqual([])
})

test("reasoned CSS exceptions are retained as info and do not suppress another rule or later declarations", () => {
  const checks = lint(`/* design-lint-allow design/no-solid-line-height: reviewed icon glyph */
.a { line-height: 1; color: #336699; }
.b { line-height: 1; }
.c { line-height: 100%; /* design-lint-allow design/no-solid-line-height: display mark */ }
/* design-lint-allow design/prefer-color-token: */
.d { background: #ff0000; }
/* design-lint-allow design/no-solid-line-height */
.e { line-height: 1em; }`)
  expect(checks.find((check) => check.selector === "source src/main.css:3")?.severity).toBe("review")
  expect(checks.find((check) => check.selector === "source src/main.css:4")).toMatchObject({ severity: "info" })
  expect(checks.find((check) => check.selector === "source src/main.css:4")?.evidence).toContain("display mark")
  expect(
    checks.filter((check) => check.rule === "design/prefer-color-token").every((check) => check.severity === "review"),
  ).toBe(true)
  expect(checks.find((check) => check.selector === "source src/main.css:8")?.severity).toBe("review")
  expect(
    lint('.a {content: "/* design-lint-allow design/no-solid-line-height: copy */"; line-height: 1;}')[0]!.severity,
  ).toBe("review")
  expect(
    lint(
      "<style>/* design-lint-allow design/no-solid-line-height: icon */</style>\n<style>.a {line-height:1;}</style>",
      "index.html",
    )[0]!.severity,
  ).toBe("review")
})

test("stable lint keys survive added lines and honor existing accepted design decisions", () => {
  const [check] = lint(".a { line-height: 1; }")
  const [moved] = lint("\n\n.a { line-height: 1; }")
  expect(check!.key).toBe(moved!.key)
  const settled = DesignQuality.settle([moved!], [{ id: `accept:${check!.key}`, text: "Reviewed display typography" }])
  expect(settled.checks).toEqual([])
  expect(settled.findings[0]).toContain("accepted exception")
})

test("lint consumes immutable source blobs and excludes compiled output using the existing bounded scan", async () => {
  await using tmp = await tmpdir()
  const original = ".a { color: #336699; line-height: 1; }"
  const hash = DesignFiles.hash(original)
  await Bun.write(path.join(tmp.path, hash), original)
  await Bun.write(path.join(tmp.path, "work", "main.css"), ".a { color: var(--brand); line-height: 1.2; }")
  const read = await DesignReuse.read(tmp.path, { "main.css": hash, ".compiled/main.css": hash })
  expect(read.files).toEqual([{ file: "main.css", text: original }])
  expect(DesignLint.check({ files: read.files, sources, width: 1440 })).toHaveLength(2)
})

test("caps a noisy audit and counts omitted findings, prioritizing review over source exceptions", () => {
  const checks = DesignLint.check({
    files: Array.from({ length: 25 }, (_, index) => ({
      file: `view-${index}.css`,
      text: `${index < 5 ? "/* design-lint-allow design/no-solid-line-height: icon */" : ""}\n.a {line-height:1;}`,
    })),
    sources: [],
    width: 1440,
  })
  expect(checks).toHaveLength(21)
  expect(checks.slice(0, 20).every((check) => check.severity === "review")).toBe(true)
  expect(checks.at(-1)?.evidence).toContain("5 additional")
})
