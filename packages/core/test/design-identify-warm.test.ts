import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { DesignIdentify } from "@opencode/core/design/identify"
import type { EvaluationInput } from "@opencode/core/intelligence"

// A project with a Tailwind theme and components, so identification has something to ask System One about.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "redcode-design-warm-"))
const state = fs.mkdtempSync(path.join(os.tmpdir(), "redcode-design-warm-state-"))
for (const [file, content] of Object.entries({
  "package.json": JSON.stringify({ name: "web", dependencies: { react: "^19.0.0", tailwindcss: "^3.4.0" } }),
  "tailwind.config.ts": "export default {}\n",
  "src/styles/globals.css": "@tailwind base;\n:root {\n  --primary: #111;\n}\n",
  "src/components/Button.tsx": "export function Button() { return <button /> }\n",
})) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), content)
}
fs.mkdirSync(path.join(root, ".git"), { recursive: true })
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(state, { recursive: true, force: true })
})

/** Warms identification and returns the System One operations it asked for. */
const warm = (mode: "single" | "dual") => {
  const operations: string[] = []
  return Effect.runPromise(
    DesignIdentify.warm({
      directory: root,
      state: path.join(state, `${mode}.json`),
      mode,
      sessionID: "ses_design_warm",
      evaluate: (input: EvaluationInput) =>
        Effect.sync(() => {
          operations.push(input.operation)
          return undefined
        }),
    }),
  ).then(() => operations)
}

describe("DesignIdentify warm-up", () => {
  test("the design agent or a design-routed request wants a warm-up", () => {
    expect(DesignIdentify.wanted({ agent: "design" })).toBe(true)
    expect(DesignIdentify.wanted({ agent: "build", route: "design" })).toBe(true)
    expect(DesignIdentify.wanted({ agent: "build" })).toBe(false)
    expect(DesignIdentify.wanted({ agent: "plan", route: "code" })).toBe(false)
  })

  test("dual reasoning asks System One to identify the design system", async () => {
    expect(await warm("dual")).toEqual(["design_system_detect"])
  })

  test("single reasoning waits for the design agent and asks nothing", async () => {
    expect(await warm("single")).toEqual([])
  })
})
