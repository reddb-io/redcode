import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { parse } from "jsonc-parser"
import { DesignProposal } from "../src/design/proposal"
import { DesignDetect } from "../src/design/detect"
import { DesignBrowserLauncher } from "../src/design/browser-launcher"
import { tmpdir } from "./fixture/tmpdir"

const shadcn = async (root: string) => {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ dependencies: { react: "^19.0.0", tailwindcss: "^3.4.0" } }),
    "tailwind.config.ts": "export default {}\n",
    "src/styles/globals.css": "@tailwind base;\n",
    "src/components/Button.tsx": "export function Button() { return <button /> }\n",
  }
  for (const [file, content] of Object.entries(files)) await Bun.write(path.join(root, file), content)
}

const offer = (
  directory: string,
  state: string,
  reply: string | undefined,
  options: { configured?: boolean; now?: number } = {},
) => {
  const asked: string[] = []
  return Effect.runPromise(
    DesignProposal.offer({
      directory,
      state,
      configured: options.configured ?? false,
      now: options.now,
      ask: (request) =>
        Effect.sync(() => {
          asked.push(request.question)
          expect(request.options.map((option) => option.label)).toEqual(["Yes", "Edit later", "No"])
          return reply
        }),
    }),
  ).then((outcome) => ({ outcome, asked }))
}

test("Yes writes the design section into the existing config, keeping comments, keys and indentation", async () => {
  await using tmp = await tmpdir()
  await shadcn(tmp.path)
  const original = `{\n    // team settings\n    "$schema": "https://redcode.dev/config.json",\n    "compaction": { "auto": false },\n    "design": { "browser": "firefox" }\n}\n`
  await Bun.write(path.join(tmp.path, "redcode.jsonc"), original)
  const state = path.join(tmp.path, "state", DesignProposal.STATE)
  const { outcome, asked } = await offer(tmp.path, state, "Yes")
  expect(asked).toHaveLength(1)
  expect(asked[0]).toStartWith("Use detected design system?\nApplication: project root")
  expect(outcome.status).toBe("adopted")
  const text = await Bun.file(path.join(tmp.path, "redcode.jsonc")).text()
  expect(text).toContain("    // team settings\n")
  expect(text).toContain('"compaction": { "auto": false }')
  expect(text).toContain('\n        "system": {')
  const config = parse(text) as { design: { browser: string; system: unknown }; $schema: string }
  expect(config.$schema).toBe("https://redcode.dev/config.json")
  expect(config.design.browser).toBe("firefox")
  expect(config.design.system).toEqual({
    paths: ["src/components"],
    css: ["src/styles/globals.css"],
    tailwind: true,
    framework: "react",
  })
  expect(await Bun.file(path.join(tmp.path, ".red/DESIGN.md")).text()).toContain("### src/components")
  expect(DesignProposal.report(outcome, tmp.path)).toContain("wrote design.system to redcode.jsonc")

  // Writing again is idempotent, and a configured project is never asked.
  expect(await DesignProposal.write(tmp.path, (await DesignDetect.detect(tmp.path))!)).toEqual({
    file: path.join(tmp.path, "redcode.jsonc"),
    changed: false,
  })
  const again = await offer(tmp.path, state, "Yes", { configured: true })
  expect(again.outcome.status).toBe("configured")
  expect(again.asked).toHaveLength(0)
})

test("the config target is the highest-precedence existing file, else a new redcode.json; monorepos record the application", async () => {
  await using tmp = await tmpdir()
  const proposal: DesignDetect.Proposal = {
    ...(await (async () => {
      await shadcn(tmp.path)
      return (await DesignDetect.detect(tmp.path))!
    })()),
    application: "apps/web",
  }
  expect(DesignProposal.target(tmp.path)).toBe(path.join(tmp.path, "redcode.json"))
  await DesignProposal.write(tmp.path, proposal)
  const created = JSON.parse(await Bun.file(path.join(tmp.path, "redcode.json")).text())
  expect(created.design.application).toBe("apps/web")
  expect(created.design.system.paths).toEqual(["src/components"])

  await Bun.write(path.join(tmp.path, "config.json"), "[1]")
  expect(DesignProposal.target(tmp.path)).toBe(path.join(tmp.path, "config.json"))
  expect(DesignProposal.write(tmp.path, proposal)).rejects.toThrow("config.json is not a valid JSON object")
})

test("No is remembered for the project and Edit later snoozes for a day; nothing is written to config", async () => {
  await using tmp = await tmpdir()
  await shadcn(tmp.path)
  const state = path.join(tmp.path, "state", DesignProposal.STATE)
  const now = 1_000_000

  const later = await offer(tmp.path, state, "Edit later", { now })
  expect(later.outcome.status).toBe("later")
  expect((await offer(tmp.path, state, "Yes", { now: now + 1000 })).outcome.status).toBe("snoozed")
  const dismissed = await offer(tmp.path, state, undefined, { now: now + DesignProposal.SNOOZE + 1 })
  expect(dismissed.asked).toHaveLength(1)
  expect(dismissed.outcome.status).toBe("later")

  const declined = await offer(tmp.path, state, "No", { now: now + 3 * DesignProposal.SNOOZE })
  expect(declined.outcome.status).toBe("declined")
  const remembered = await offer(tmp.path, state, "Yes", { now: now + 100 * DesignProposal.SNOOZE })
  expect(remembered.outcome.status).toBe("dismissed")
  expect(remembered.asked).toHaveLength(0)
  expect(await Bun.file(path.join(tmp.path, "redcode.json")).exists()).toBe(false)
  expect(JSON.parse(await Bun.file(state).text())[tmp.path]).toEqual({ dismissed: now + 3 * DesignProposal.SNOOZE })
})

test("a project without a detected design system is never asked", async () => {
  await using tmp = await tmpdir()
  const { outcome, asked } = await offer(tmp.path, path.join(tmp.path, "state.json"), "Yes")
  expect(outcome.status).toBe("none")
  expect(asked).toHaveLength(0)
})

test("configured reads the effective design section statically, project over global", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "repo/.git"), { recursive: true })
  await Bun.write(path.join(tmp.path, "global/config.json"), JSON.stringify({ design: { browser: "chromium" } }))
  expect(await DesignProposal.configured(path.join(tmp.path, "repo"), path.join(tmp.path, "global"))).toEqual({
    browser: "chromium",
  })
  await Bun.write(
    path.join(tmp.path, "repo/.red/code/config.jsonc"),
    '{ // local\n "design": { "system": { "paths": ["src/ui"] } } }',
  )
  expect(await DesignProposal.configured(path.join(tmp.path, "repo"), path.join(tmp.path, "global"))).toEqual({
    system: { paths: ["src/ui"] },
  })
})

test("REDCODE_DESIGN_BROWSER wins over design.browser, which wins over the built-in choice", () => {
  expect(DesignBrowserLauncher.browser({ REDCODE_DESIGN_BROWSER: "firefox" }, "chromium")).toBe("firefox")
  expect(DesignBrowserLauncher.browser({ REDCODE_DESIGN_BROWSER: "  " }, " chromium ")).toBe("chromium")
  expect(DesignBrowserLauncher.browser({}, "default")).toBe("default")
  expect(DesignBrowserLauncher.browser({})).toBeUndefined()
})
