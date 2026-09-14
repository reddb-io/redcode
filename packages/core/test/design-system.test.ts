import { expect, test } from "bun:test"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { DesignSystem } from "../src/design/system"
import { tmpdir } from "./fixture/tmpdir"

test("discovers root design guidance and supported nested source files with content provenance", async () => {
  await using tmp = await tmpdir()
  const files = [
    "DESIGN.md",
    "PRODUCT.md",
    "docs/DESIGN.md",
    "design-system.md",
    "tailwind.config.ts",
    "components.json",
    "src/tokens.css",
    "src/styles/tokens.ts",
    "src/config/tokens.json",
    "src/theme.css",
    "src/layout/theme.ts",
    "src/global.css",
    "src/app/globals.css",
    "src/components/index.ts",
    "src/design-system/index.tsx",
    "packages/ui/src/index.ts",
    ".storybook/main.ts",
    "postcss.config.js",
    "package.json",
  ]
  const stories = ["src/components/Button.stories.tsx", "packages/ui/src/Card.stories.tsx", "stories/Intro.stories.mdx"]
  await Promise.all(
    [...files, ...stories, "tokens.css", "src/tokens.jsx", "node_modules/package/DESIGN.md", "src/index.ts"].map(
      (file) =>
        Bun.write(
          path.join(tmp.path, file),
          file === "DESIGN.md"
            ? ""
            : file === "package.json"
              ? JSON.stringify({
                  name: "fixture",
                  scripts: { secret: "deploy --token" },
                  dependencies: { react: "^18.3.1", "@radix-ui/react-dialog": "^1.1.0" },
                  devDependencies: { tailwindcss: "^3.4.1", vitest: "^2.0.0" },
                })
              : file,
        ),
    ),
  )
  const started = Date.now()
  const sources = await DesignSystem.discover(tmp.path)
  expect(sources.map((source) => source.file.split(path.sep).join("/"))).toEqual([
    ...files.toSorted(),
    ...stories.toSorted(),
  ])
  expect(sources.filter((source) => source.authoritative).map((source) => source.file)).toEqual([
    "DESIGN.md",
    "PRODUCT.md",
    "design-system.md",
    "docs/DESIGN.md",
  ])
  expect(sources[1].file).toBe("DESIGN.md")
  expect(sources[1].hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  expect(sources[1].excerpt).toBe("")
  expect(sources.every((source) => source.observed >= started && source.observed <= Date.now())).toBe(true)
  expect(sources.find((source) => source.file === "package.json")?.excerpt).toBe(
    "@radix-ui/react-dialog ^1.1.0\nreact ^18.3.1\ntailwindcss ^3.4.1",
  )
  expect(sources.find((source) => source.file === "src/components/index.ts")?.excerpt).toBe("src/components/index.ts")
  expect(
    sources.filter((source) => DesignSystem.classify(source.file) === "story").map((source) => source.excerpt),
  ).toEqual(["", "", ""])
  expect(stories.every((story) => sources.find((source) => source.file === story)?.hash.length === 64)).toBe(true)
  expect(DesignSystem.roots(sources, ["src/components/", "src/components/buttons"])).toEqual([
    "packages/ui/src",
    "src/components",
    "src/design-system",
  ])
  expect(DesignSystem.stack(sources)).toMatchObject({
    framework: "react ^18.3.1",
    pipeline: [
      "Tailwind (tailwind.config.ts)",
      "PostCSS (postcss.config.js)",
      "shadcn (components.json)",
      "Storybook (.storybook/main.ts)",
    ],
  })

  await Bun.write(path.join(tmp.path, "DESIGN.md"), "# Design system\nUse a cyan accent for checkout.")
  const refreshed = await DesignSystem.discover(tmp.path)
  expect(refreshed[1].hash).not.toBe(sources[1].hash)
  expect(refreshed[1].excerpt).toBe("# Design system\nUse a cyan accent for checkout.")
})

test("records package.json only when it declares a design dependency", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ dependencies: { effect: "^4.0.0" } }))
  expect(await DesignSystem.discover(tmp.path)).toEqual([])
  await Bun.write(path.join(tmp.path, "package.json"), "{not json")
  expect(await DesignSystem.discover(tmp.path)).toEqual([])
})

test("discovers product context in supported context directories without losing its provenance", async () => {
  await using tmp = await tmpdir()
  const files = [".red/PRODUCT.md", ".red/DESIGN.md", ".agents/context/product.md", "docs/design.md"]
  await Promise.all(files.map((file) => Bun.write(path.join(tmp.path, file), `Guidance from ${file}`)))
  const sources = await DesignSystem.discover(tmp.path)
  expect(sources.map((source) => source.file)).toEqual(files.toSorted())
  expect(sources.every((source) => source.authoritative && source.excerpt === `Guidance from ${source.file}`)).toBe(
    true,
  )
})

test("keeps the deterministic sixty-source limit with excerpts for the first twenty", async () => {
  await using tmp = await tmpdir()
  const files = Array.from({ length: 65 }, (_, index) => `src/group-${String(index).padStart(2, "0")}/tokens.css`)
  await Promise.all(files.toReversed().map((file) => Bun.write(path.join(tmp.path, file), file)))
  const sources = await DesignSystem.discover(tmp.path)
  expect(sources.map((source) => source.file.split(path.sep).join("/"))).toEqual(files.slice(0, 60))
  expect(sources.map((source) => source.excerpt)).toEqual([...files.slice(0, 20), ...Array(40).fill("")])
  expect(sources.every((source) => source.hash.length === 64)).toBe(true)
})

test("does not follow source-directory links outside the application", async () => {
  await using tmp = await tmpdir()
  const application = path.join(tmp.path, "application")
  const external = path.join(tmp.path, "external")
  await mkdir(path.join(application, "src"), { recursive: true })
  await Bun.write(path.join(external, "tokens.css"), "PRIVATE_FIXTURE_DATA")
  await symlink(external, path.join(application, "src", "linked"), process.platform === "win32" ? "junction" : "dir")
  expect(await DesignSystem.discover(application)).toEqual([])
})
