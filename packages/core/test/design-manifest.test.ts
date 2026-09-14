import { expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import path from "node:path"
import { DesignManifest } from "../src/design/manifest"
import { DesignSystem } from "../src/design/system"
import { tmpdir } from "./fixture/tmpdir"

const input = {
  stack: ["Framework: react ^18.3.1", "CSS pipeline: Tailwind (tailwind.config.ts)"],
  tokens: ["src/styles/globals.css"],
  roots: ["src/components"],
  inventory: [
    { root: "src/components", file: "src/components/Button.tsx", name: "Button", props: "ButtonProps" },
    { root: "src/components", file: "src/components/Card.tsx", name: "Card" },
  ],
}

const project = async (root: string) => {
  await Promise.all(
    Object.entries({
      "package.json": JSON.stringify({
        dependencies: { react: "^18.3.1" },
        devDependencies: { tailwindcss: "^3.4.1" },
      }),
      "tailwind.config.ts": "export default { content: ['./src/**/*.tsx'] }",
      "src/styles/globals.css": ":root { --accent: #0af; }",
      "src/components/index.ts": 'export { Button } from "./Button"\nexport { Card } from "./Card"',
      "src/components/Button.tsx": "export const Button = () => null",
      "src/components/Card.tsx": "export const Card = () => null",
    }).map(([file, content]) => Bun.write(path.join(root, file), content)),
  )
}

test("writes the manifest once, rewrites only the marked block when it changed and keeps the Notes verbatim", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, ".red", "DESIGN.md")
  expect(await DesignManifest.write(tmp.path, input, false)).toEqual({ status: "created" })
  const generated = await Bun.file(file).text()
  expect(generated).toContain("## Stack\n- Framework: react ^18.3.1\n- CSS pipeline: Tailwind (tailwind.config.ts)")
  expect(generated).toContain("## Tokens\n- src/styles/globals.css")
  expect(generated).toContain(
    "### src/components\n- Button (src/components/Button.tsx, ButtonProps)\n- Card (src/components/Card.tsx)",
  )
  expect(generated).toContain(`## Notes\n${DesignManifest.NOTES}`)
  expect(await DesignManifest.write(tmp.path, { ...input, tokens: [] }, false)).toEqual({ status: "unchanged" })
  expect(await Bun.file(file).text()).toBe(generated)

  const edited = generated
    .replace("# Design system", "# Acme design system\n\nHand-written intro above the block.")
    .replace(`${DesignManifest.NOTES}\n`, `${DesignManifest.NOTES}\nUse 4px rhythm; never reuse LegacyTable.\n`)
  await Bun.write(file, edited)
  const before = (await stat(file)).mtimeMs
  expect(await DesignManifest.write(tmp.path, input, true)).toEqual({ status: "unchanged" })
  expect((await stat(file)).mtimeMs).toBe(before)
  expect(await DesignManifest.write(tmp.path, { ...input, tokens: ["src/tokens.css"], roots: [] }, true)).toEqual({
    status: "updated",
  })
  const refreshed = await Bun.file(file).text()
  expect(refreshed.startsWith("# Acme design system\n\nHand-written intro above the block.\n")).toBe(true)
  expect(refreshed).toContain("## Tokens\n- src/tokens.css")
  expect(refreshed).not.toContain("src/styles/globals.css")
  expect(refreshed).toContain("## Components\n- No component root")
  expect(refreshed.endsWith(edited.slice(edited.indexOf(DesignManifest.END) + DesignManifest.END.length))).toBe(true)
  expect(refreshed).toContain("Use 4px rhythm; never reuse LegacyTable.")
})

test("keeps a hand-written or damaged manifest and says why", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, ".red", "DESIGN.md")
  const cases: [string, string][] = [
    ["# Ours\nHand-maintained.", "user-authored, no generated markers"],
    [
      `# Ours\n${DesignManifest.START}\nno end`,
      "generated markers are duplicated or incomplete; repair or remove them",
    ],
    [
      `${DesignManifest.START}\na\n${DesignManifest.END}\n${DesignManifest.START}\nb\n${DesignManifest.END}`,
      "generated markers are duplicated or incomplete; repair or remove them",
    ],
    [
      `${DesignManifest.END}\nreversed\n${DesignManifest.START}`,
      "generated end marker precedes the start marker; repair it",
    ],
  ]
  for (const [content, reason] of cases) {
    await Bun.write(file, content)
    expect(await DesignManifest.write(tmp.path, input, true)).toEqual({ status: "kept", reason })
    expect(await Bun.file(file).text()).toBe(content)
  }
  await Bun.write(file, "# Ours\nHand-maintained.")
  expect((await DesignSystem.discover(tmp.path)).map((source) => [source.file, source.authoritative])).toEqual([
    [".red/DESIGN.md", true],
  ])
})

test("preserves CRLF line endings when the manifest uses them", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, ".red", "DESIGN.md")
  await Bun.write(file, DesignManifest.render(input).replaceAll("\n", "\r\n"))
  expect(await DesignManifest.write(tmp.path, input, true)).toEqual({ status: "unchanged" })
  expect(await DesignManifest.write(tmp.path, { ...input, tokens: ["src/tokens.css"] }, true)).toEqual({
    status: "updated",
  })
  const text = await Bun.file(file).text()
  expect(text).toContain("## Tokens\r\n- src/tokens.css\r\n")
  expect(text.includes("\n") && !/[^\r]\n/.test(text)).toBe(true)
})

test("load generates the manifest for an existing application with something to record and reports its status", async () => {
  await using tmp = await tmpdir()
  expect(await DesignSystem.load(tmp.path, { refresh: false, manifest: false })).toEqual({
    sources: [],
    inventory: [],
    manifest: "",
  })
  expect(await DesignSystem.load(tmp.path, { refresh: false, manifest: true })).toEqual({
    sources: [],
    inventory: [],
    manifest: ".red/DESIGN.md not generated: nothing found to record",
  })
  expect(await Bun.file(path.join(tmp.path, ".red", "DESIGN.md")).exists()).toBe(false)
  await project(tmp.path)
  const skipped = await DesignSystem.load(tmp.path, { refresh: false, manifest: false })
  expect(skipped.manifest).toBe("")
  expect(skipped.sources.some((source) => source.file === ".red/DESIGN.md")).toBe(false)
  expect(await Bun.file(path.join(tmp.path, ".red", "DESIGN.md")).exists()).toBe(false)
  const loaded = await DesignSystem.load(tmp.path, { refresh: false, manifest: true })
  expect(loaded.manifest).toBe("generated .red/DESIGN.md")
  expect(loaded.inventory.map((entry) => entry.name)).toEqual(["Button", "Card"])
  const manifest = loaded.sources.find((source) => source.file === ".red/DESIGN.md")
  expect(manifest?.authoritative).toBe(false)
  expect(manifest?.excerpt).toContain("- Framework: react ^18.3.1")
  expect(manifest?.excerpt).toContain(
    "- CSS pipeline: Tailwind (tailwind.config.ts), CSS custom properties (src/styles/globals.css)",
  )
  expect(manifest?.excerpt).toContain("- Button (src/components/Button.tsx)")
  expect((await DesignSystem.load(tmp.path, { refresh: true, manifest: true })).manifest).toBe("")
  await Bun.write(path.join(tmp.path, ".red", "DESIGN.md"), "# Ours")
  expect((await DesignSystem.load(tmp.path, { refresh: true, manifest: true })).manifest).toBe(
    ".red/DESIGN.md kept as is: user-authored, no generated markers",
  )
})

test("describe and summary carry paths and counts, never file content", async () => {
  await using tmp = await tmpdir()
  await project(tmp.path)
  await Bun.write(path.join(tmp.path, "DESIGN.md"), "# Secret guidance\nDO NOT LEAK")
  const loaded = await DesignSystem.load(tmp.path, { refresh: false, manifest: true })
  const described = DesignSystem.describe(loaded)
  expect(described).toContain(
    "Manifest: .red/DESIGN.md (generated from the files below; read it first, edit only its Notes)",
  )
  expect(described).toContain("Manifest status: generated .red/DESIGN.md")
  expect(described).toContain("Docs: DESIGN.md (authoritative; read with the read tool before designing)")
  expect(described).toContain("Tokens: src/styles/globals.css")
  expect(described).toContain("Pipeline: Tailwind (tailwind.config.ts); CSS custom properties (src/styles/globals.css)")
  expect(described).toContain("Framework: react ^18.3.1")
  expect(described).toContain("Components src/components: Button, Card")
  expect(described).not.toContain("DO NOT LEAK")
  expect(described).not.toContain("## Stack")
  expect(DesignSystem.summary(loaded)).toBe(
    "manifest .red/DESIGN.md; docs DESIGN.md; 1 token file; 2 components in src/components",
  )
  expect(
    DesignSystem.describe({ sources: [], system: { paths: ["src/ui"], css: ["src/app.css"], tailwind: true } }),
  ).toContain("Configured: paths src/ui; css src/app.css; tailwind on")
  expect(DesignSystem.declared({ system: { paths: ["src/ui"] } })).toEqual(["src/ui"])
  expect(DesignSystem.declared({ system: "broken" })).toEqual([])
  expect(DesignSystem.declared({})).toEqual([])
  expect(DesignSystem.describe({ sources: [] })).toBe(
    "Design system: none detected. Say so in designSystem and design from the brief; do not assume a component library.",
  )
  expect(DesignSystem.summary({ sources: [] })).toBe("")
})
