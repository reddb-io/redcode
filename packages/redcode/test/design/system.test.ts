import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { Ripgrep } from "@reddb-io/redcode-core/ripgrep"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { DesignSystem } from "@/design/system"
import { testEffect } from "../lib/effect"

describe("reading a project's design system, the pure parts", () => {
  test("the stack names what we recognise, nearest package first, once", () => {
    expect(
      DesignSystem.stackFrom([
        { dependencies: { "solid-js": "^1.9.10", "@kobalte/core": "0.13.0" } },
        { devDependencies: { tailwindcss: "^4.1.11", "solid-js": "1.0.0", leftpad: "1" } },
      ]),
    ).toEqual(["Solid 1.9.10", "Kobalte (headless components) 0.13.0", "Tailwind 4.1.11"])
  })

  test("tokens come from :root or @theme, values kept, capped", () => {
    const css = `/* --commented: out; */ :root { --bg: #fff; --accent: oklch(60% 0.2 30); color: red } @theme { --font-sans: "Inter", sans-serif }`
    expect(DesignSystem.tokensFrom(css)).toEqual([
      "--bg: #fff",
      "--accent: oklch(60% 0.2 30)",
      '--font-sans: "Inter", sans-serif',
    ])
    const many = ":root{" + Array.from({ length: 60 }, (_, i) => `--t${i}: ${i};`).join("") + "}"
    expect(DesignSystem.tokensFrom(many)).toHaveLength(DesignSystem.MAX_TOKENS)
  })

  test("fonts skip the generic and system names", () => {
    expect(
      DesignSystem.fontsFrom(
        `h1{font-family:"Playfair Display", Georgia, serif} body{font-family: Inter, system-ui, sans-serif}`,
      ),
    ).toEqual(["Playfair Display", "Georgia", "Inter"])
  })

  test("render says so when there is nothing", () => {
    expect(DesignSystem.render({ stack: [], tokens: [], fonts: [], pages: [] })).toContain("No design system was found")
    const text = DesignSystem.render({
      stack: ["Tailwind 4.1.11"],
      tokensFile: "src/app.css",
      tokens: ["--bg: #fff"],
      fonts: ["Inter"],
      pages: ["src/pages/home.tsx"],
      shadcn: "components.json",
    })
    expect(text).toContain("Stack: Tailwind 4.1.11.")
    expect(text).toContain("Tokens (src/app.css):\n- --bg: #fff")
    expect(text).toContain("shadcn/ui")
    expect(text).toContain("- src/pages/home.tsx")
  })
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([DesignSystem.node, Ripgrep.node, FSUtil.node, CrossSpawnSpawner.node])),
)

const write = (dir: string, files: Record<string, string>) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    for (const [name, content] of Object.entries(files)) {
      yield* fs.ensureDir(path.dirname(path.join(dir, name)))
      yield* Effect.promise(() => Bun.write(path.join(dir, name), content))
    }
  })

describe("reading a project's design system, from disk", () => {
  it.instance("scans a Tailwind v4 + Kobalte project and writes .red/DESIGN.md", () =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* write(ctx.directory, {
        "package.json": JSON.stringify({
          dependencies: { "solid-js": "^1.9.10", "@kobalte/core": "^0.13.0" },
          devDependencies: { tailwindcss: "^4.1.11" },
        }),
        "src/app.css": `@import "tailwindcss"; @theme { --color-bg: #0b0b0c; --color-accent: #b0413e; --font-display: "Fraunces", serif }`,
        "src/pages/settings.tsx": "export default () => null",
      })
      const text = yield* (yield* DesignSystem.Service).summary()
      expect(text).toContain("Stack: Solid 1.9.10, Kobalte (headless components) 0.13.0, Tailwind 4.1.11.")
      expect(text).toContain("Tokens (src/app.css):")
      expect(text).toContain("- --color-accent: #b0413e")
      expect(text).toContain("Fonts: Fraunces.")
      expect(text).toContain("- src/pages/settings.tsx")
      const written = yield* Effect.promise(() => Bun.file(path.join(ctx.directory, ".red/DESIGN.md")).text())
      expect(written.startsWith(DesignSystem.HEADER)).toBe(true)
      expect(written).toContain("Stack: Solid")
    }),
  )

  it.instance("a hand-written DESIGN.md wins, and nothing is generated", () =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* write(ctx.directory, {
        "package.json": JSON.stringify({ dependencies: { react: "18.0.0" } }),
        "DESIGN.md": "# Ours\n\nWarm greys, one red. Nothing rounded.\n",
      })
      const text = yield* (yield* DesignSystem.Service).summary()
      expect(text).toBe("# Ours\n\nWarm greys, one red. Nothing rounded.")
      expect(yield* (yield* FSUtil.Service).existsSafe(path.join(ctx.directory, ".red/DESIGN.md"))).toBe(false)
    }),
  )

  it.instance("a Tailwind v3 config and :root tokens in plain CSS", () =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* write(ctx.directory, {
        "package.json": JSON.stringify({ devDependencies: { tailwindcss: "^3.4.0" } }),
        "tailwind.config.ts": "export default { theme: { extend: {} } }",
        "styles/tokens.css": ":root { --bg: #fff; --fg: #111 }",
        "styles/other.css": ".x { --local: 1 }",
      })
      const text = yield* (yield* DesignSystem.Service).summary()
      expect(text).toContain("Tailwind 3.4.0")
      expect(text).toContain("Tailwind config: tailwind.config.ts")
      expect(text).toContain("Tokens (styles/tokens.css):")
    }),
  )

  it.instance("nothing to find says so", () =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* write(ctx.directory, { "README.md": "hello" })
      const text = yield* (yield* DesignSystem.Service).summary()
      expect(text).toContain("No design system was found")
    }),
  )
})
