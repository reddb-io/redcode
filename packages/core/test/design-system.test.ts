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
  ]
  await Promise.all(
    [...files, "tokens.css", "src/tokens.jsx", "node_modules/package/DESIGN.md"].map((file) =>
      Bun.write(path.join(tmp.path, file), file === "DESIGN.md" ? "" : file),
    ),
  )
  const started = Date.now()
  const sources = await DesignSystem.discover(tmp.path)
  expect(sources.map((source) => source.file.split(path.sep).join("/"))).toEqual(files.toSorted())
  expect(sources.filter((source) => source.authoritative).map((source) => source.file)).toEqual([
    "DESIGN.md",
    "PRODUCT.md",
    "design-system.md",
    "docs/DESIGN.md",
  ])
  expect(sources[0].hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  expect(sources[0].excerpt).toBe("")
  expect(sources.every((source) => source.observed >= started && source.observed <= Date.now())).toBe(true)

  await Bun.write(path.join(tmp.path, "DESIGN.md"), "# Design system\nUse a cyan accent for checkout.")
  const refreshed = await DesignSystem.discover(tmp.path)
  expect(refreshed[0].hash).not.toBe(sources[0].hash)
  expect(refreshed[0].excerpt).toBe("# Design system\nUse a cyan accent for checkout.")
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

test("keeps the deterministic thirty-source limit", async () => {
  await using tmp = await tmpdir()
  const files = Array.from({ length: 35 }, (_, index) => `src/group-${String(index).padStart(2, "0")}/tokens.css`)
  await Promise.all(files.toReversed().map((file) => Bun.write(path.join(tmp.path, file), file)))
  expect((await DesignSystem.discover(tmp.path)).map((source) => source.file.split(path.sep).join("/"))).toEqual(
    files.slice(0, 30),
  )
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
