import { expect, test } from "bun:test"
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

test("writes the manifest once, rewrites only the marked block on refresh and keeps the Notes verbatim", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, ".red", "DESIGN.md")
  expect(await DesignManifest.write(tmp.path, input, false)).toBe(true)
  const generated = await Bun.file(file).text()
  expect(generated).toContain("## Stack\n- Framework: react ^18.3.1\n- CSS pipeline: Tailwind (tailwind.config.ts)")
  expect(generated).toContain("## Tokens\n- src/styles/globals.css")
  expect(generated).toContain(
    "### src/components\n- Button (src/components/Button.tsx, ButtonProps)\n- Card (src/components/Card.tsx)",
  )
  expect(generated).toContain(`## Notes\n${DesignManifest.NOTES}`)
  expect(await DesignManifest.write(tmp.path, { ...input, tokens: [] }, false)).toBe(false)
  expect(await Bun.file(file).text()).toBe(generated)

  const edited = generated
    .replace("# Design system", "# Acme design system\n\nHand-written intro above the block.")
    .replace(`${DesignManifest.NOTES}\n`, `${DesignManifest.NOTES}\nUse 4px rhythm; never reuse LegacyTable.\n`)
  await Bun.write(file, edited)
  expect(await DesignManifest.write(tmp.path, { ...input, tokens: ["src/tokens.css"], inventory: [] }, true)).toBe(true)
  const refreshed = await Bun.file(file).text()
  expect(refreshed.startsWith("# Acme design system\n\nHand-written intro above the block.\n")).toBe(true)
  expect(refreshed).toContain("## Tokens\n- src/tokens.css")
  expect(refreshed).not.toContain("src/styles/globals.css")
  expect(refreshed).toContain("### src/components\n- No exported PascalCase components found.")
  expect(refreshed.endsWith(edited.slice(edited.indexOf(DesignManifest.END) + DesignManifest.END.length))).toBe(true)
  expect(refreshed).toContain("Use 4px rhythm; never reuse LegacyTable.")
})

test("never rewrites a manifest the user authored without markers", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, ".red", "DESIGN.md")
  await Bun.write(file, "# Ours\nHand-maintained.")
  expect(await DesignManifest.write(tmp.path, input, true)).toBe(false)
  expect(await Bun.file(file).text()).toBe("# Ours\nHand-maintained.")
  expect((await DesignSystem.discover(tmp.path)).map((source) => [source.file, source.authoritative])).toEqual([
    [".red/DESIGN.md", true],
  ])
})

test("load discovers, inventories and records the generated manifest as an authoritative source", async () => {
  await using tmp = await tmpdir()
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
    }).map(([file, content]) => Bun.write(path.join(tmp.path, file), content)),
  )
  const loaded = await DesignSystem.load(tmp.path, { refresh: false })
  expect(loaded.inventory.map((entry) => entry.name)).toEqual(["Button", "Card"])
  const manifest = loaded.sources.find((source) => source.file === ".red/DESIGN.md")
  expect(manifest?.authoritative).toBe(true)
  expect(manifest?.excerpt).toContain("- Framework: react ^18.3.1")
  expect(manifest?.excerpt).toContain(
    "- CSS pipeline: Tailwind (tailwind.config.ts), CSS custom properties (src/styles/globals.css)",
  )
  expect(manifest?.excerpt).toContain("- Button (src/components/Button.tsx)")
  const described = DesignSystem.describe({ sources: loaded.sources, inventory: loaded.inventory })
  expect(described).toContain("Doc .red/DESIGN.md (generated, edit the Notes section):\n# Design system")
  expect(described).toContain("Tokens: src/styles/globals.css")
  expect(described).toContain("Pipeline: Tailwind (tailwind.config.ts); CSS custom properties (src/styles/globals.css)")
  expect(described).toContain("Framework: react ^18.3.1")
  expect(described).toContain("Components src/components: Button, Card")
  expect(
    DesignSystem.describe({ sources: [], system: { paths: ["src/ui"], css: ["src/app.css"], tailwind: true } }),
  ).toContain("Configured: paths src/ui; css src/app.css; tailwind on")
  expect(DesignSystem.describe({ sources: [] })).toBe(
    "Design system: none detected. Say so in designSystem and design from the brief; do not assume a component library.",
  )
  expect(DesignSystem.summary({ sources: loaded.sources, inventory: loaded.inventory })).toBe(
    "docs .red/DESIGN.md; 1 token file; 2 components in src/components",
  )
  expect(DesignSystem.summary({ sources: [] })).toBe("")
})

test("bounds each rendered document excerpt to two kilobytes", () => {
  const described = DesignSystem.describe({
    sources: [{ file: "DESIGN.md", hash: "x", observed: 0, authoritative: true, excerpt: "a".repeat(5000) }],
  })
  expect(described).toContain("a".repeat(2000) + "\n[truncated; read the file for the rest]")
  expect(described).not.toContain("a".repeat(2001))
})
