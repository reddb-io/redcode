import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir, symlink } from "node:fs/promises"
import { Effect } from "effect"
import { parse } from "jsonc-parser"
import { ConfigDesign } from "../src/config/design"
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
  // A repository root bounds the static config walk so the test never reads the host's files.
  await mkdir(path.join(root, ".git"), { recursive: true })
}

const system = { paths: ["src/components"], css: ["src/styles/globals.css"], tailwind: true, framework: "react" }

const offer = async (
  directory: string,
  reply: string | undefined,
  options: { configured?: boolean; now?: number; global?: string; application?: string } = {},
) => {
  const asked: string[] = []
  const state = path.join(directory, ".state", DesignProposal.STATE)
  const configured =
    options.configured ?? (await DesignProposal.configured(directory, options.global))?.system !== undefined
  const outcome = await Effect.runPromise(
    DesignProposal.offer({
      directory,
      state,
      global: options.global,
      application: options.application,
      configured,
      now: options.now,
      ask: (request) =>
        Effect.sync(() => {
          asked.push(request.question)
          expect(request.options.map((option) => option.label)).toEqual(["Yes", "Edit later", "No"])
          return reply
        }),
    }),
  )
  return { outcome, asked, state }
}

test("Yes writes the design section into the existing config, keeping comments, keys and indentation", async () => {
  await using tmp = await tmpdir()
  await shadcn(tmp.path)
  const original = `{\n    // team settings\n    "$schema": "https://redcode.dev/config.json",\n    "compaction": { "auto": false },\n    "design": { "browser": "firefox" }\n}\n`
  await Bun.write(path.join(tmp.path, "redcode.jsonc"), original)
  const { outcome, asked } = await offer(tmp.path, "Yes")
  expect(asked).toHaveLength(1)
  expect(asked[0]).toStartWith("Use detected design system?\nApplication: project root")
  expect(outcome.status).toBe("adopted")
  const text = await Bun.file(path.join(tmp.path, "redcode.jsonc")).text()
  expect(text).toContain("    // team settings\n")
  expect(text).toContain('"compaction": { "auto": false }')
  expect(text).toContain('\n        "system": {')
  const config = parse(text) as { design: { browser: string; system: unknown }; $schema: string }
  expect(config.$schema).toBe("https://redcode.dev/config.json")
  expect(config.design).toEqual({ browser: "firefox", system })
  expect(await Bun.file(path.join(tmp.path, ".red/DESIGN.md")).text()).toContain("### src/components")
  expect(DesignProposal.report(outcome, tmp.path)).toContain("wrote design.system to redcode.jsonc")

  // A configured project is never asked again, and writing again changes nothing.
  const again = await offer(tmp.path, "Yes")
  expect(again.outcome.status).toBe("configured")
  expect(again.asked).toHaveLength(0)
  const proposal = (await DesignDetect.detect(tmp.path))!
  expect(await DesignProposal.write(path.join(tmp.path, "redcode.jsonc"), proposal)).toEqual({
    file: path.join(tmp.path, "redcode.jsonc"),
    changed: false,
  })
})

test("Yes writes into the project file that supplies the design section, so .red/code cannot shadow it", async () => {
  await using tmp = await tmpdir()
  await shadcn(tmp.path)
  await Bun.write(path.join(tmp.path, "redcode.json"), `{ "$schema": "https://redcode.dev/config.json" }\n`)
  await Bun.write(path.join(tmp.path, ".red/code/redcode.json"), `{\n  "design": { "browser": "firefox" }\n}\n`)
  const first = await offer(tmp.path, "Yes")
  expect(first.outcome.status).toBe("adopted")
  expect(first.outcome.status === "adopted" && first.outcome.file).toBe(path.join(tmp.path, ".red/code/redcode.json"))
  expect(await Bun.file(path.join(tmp.path, "redcode.json")).text()).toBe(
    `{ "$schema": "https://redcode.dev/config.json" }\n`,
  )
  expect(await DesignProposal.configured(tmp.path)).toEqual({ browser: "firefox", system })
  const second = await offer(tmp.path, "Yes")
  expect(second.outcome.status).toBe("configured")
  expect(second.asked).toHaveLength(0)
})

test("a global design.browser survives a project design.system, in the static reader and the merge", async () => {
  await using tmp = await tmpdir()
  await shadcn(tmp.path)
  const global = path.join(tmp.path, ".global")
  await Bun.write(path.join(global, "config.json"), JSON.stringify({ design: { browser: "chromium" } }))
  const { outcome } = await offer(tmp.path, "Yes", { global })
  expect(outcome.status === "adopted" && outcome.file).toBe(path.join(tmp.path, "redcode.json"))
  expect(await DesignProposal.configured(tmp.path, global)).toEqual({ browser: "chromium", system })
  expect(JSON.parse(await Bun.file(path.join(global, "config.json")).text())).toEqual({
    design: { browser: "chromium" },
  })

  expect(
    ConfigDesign.merge([
      { browser: "chromium", system: "global", application: "apps/global" },
      { system: "project", application: "apps/web" },
      { browser: "firefox" },
    ]),
  ).toEqual({ browser: "firefox", system: "project", application: "apps/web" })
  expect(ConfigDesign.merge([{ browser: "chromium" }, { system: "project" }])).toEqual({
    browser: "chromium",
    system: "project",
  })
  expect(ConfigDesign.merge([undefined, {}])).toBeUndefined()
})

test("commit reports configured when another system appeared meanwhile, and refuses an application outside the project", async () => {
  await using tmp = await tmpdir()
  await shadcn(tmp.path)
  const proposal = (await DesignDetect.detect(tmp.path))!
  const state = path.join(tmp.path, ".state", DesignProposal.STATE)
  await Bun.write(path.join(tmp.path, "redcode.json"), JSON.stringify({ design: { system: { paths: ["src/ui"] } } }))
  expect(await DesignProposal.commit({ directory: tmp.path, state, proposal })).toEqual({ status: "configured" })
  expect(JSON.parse(await Bun.file(path.join(tmp.path, "redcode.json")).text()).design.system).toEqual({
    paths: ["src/ui"],
  })
  expect(
    DesignProposal.commit({ directory: tmp.path, state, proposal: { ...proposal, application: "../outside" } }),
  ).rejects.toThrow("not a directory inside the project")
})

test("the config target prefers the design source, then the highest-precedence project file, then redcode.json", async () => {
  await using tmp = await tmpdir()
  await shadcn(tmp.path)
  const proposal = { ...(await DesignDetect.detect(tmp.path))!, application: "apps/web" }
  expect(DesignProposal.target(await DesignProposal.layers(tmp.path), tmp.path)).toBe(
    path.join(tmp.path, "redcode.json"),
  )
  await DesignProposal.write(path.join(tmp.path, "redcode.json"), proposal)
  const created = JSON.parse(await Bun.file(path.join(tmp.path, "redcode.json")).text())
  expect(created.design).toEqual({ system, application: "apps/web" })

  await Bun.write(path.join(tmp.path, "config.json"), "[1]")
  await Bun.write(path.join(tmp.path, ".red/code/config.jsonc"), "{}")
  const list = await DesignProposal.layers(tmp.path)
  expect(list.map((layer) => [path.relative(tmp.path, layer.file).split(path.sep).join("/"), layer.invalid])).toEqual([
    ["redcode.json", false],
    ["config.json", true],
    [".red/code/config.jsonc", false],
  ])
  expect(DesignProposal.target(list, tmp.path)).toBe(path.join(tmp.path, "redcode.json"))
  expect(DesignProposal.target(list.slice(1), tmp.path)).toBe(path.join(tmp.path, ".red/code/config.jsonc"))
  expect(DesignProposal.write(path.join(tmp.path, "config.json"), proposal)).rejects.toThrow(
    "config.json is not a valid JSON object",
  )
})

test("No is remembered for the project and Edit later snoozes for a day; nothing is written to config", async () => {
  await using tmp = await tmpdir()
  await shadcn(tmp.path)
  const now = 1_000_000

  const later = await offer(tmp.path, "Edit later", { now })
  expect(later.outcome.status).toBe("later")
  expect((await offer(tmp.path, "Yes", { now: now + 1000 })).outcome.status).toBe("snoozed")
  const dismissed = await offer(tmp.path, undefined, { now: now + DesignProposal.SNOOZE + 1 })
  expect(dismissed.asked).toHaveLength(1)
  expect(dismissed.outcome.status).toBe("later")

  const declined = await offer(tmp.path, "No", { now: now + 3 * DesignProposal.SNOOZE })
  expect(declined.outcome.status).toBe("declined")
  const remembered = await offer(tmp.path, "Yes", { now: now + 100 * DesignProposal.SNOOZE })
  expect(remembered.outcome.status).toBe("dismissed")
  expect(remembered.asked).toHaveLength(0)
  expect(await Bun.file(path.join(tmp.path, "redcode.json")).exists()).toBe(false)
  expect(JSON.parse(await Bun.file(remembered.state).text())[tmp.path]).toMatchObject({
    dismissed: now + 3 * DesignProposal.SNOOZE,
  })
})

test("nothing detected is cached until the project's top-level files change", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, ".git"), { recursive: true })
  const empty = await offer(tmp.path, "Yes", { now: Date.now() })
  expect(empty.outcome.status).toBe("none")
  expect(Object.keys(JSON.parse(await Bun.file(empty.state).text())[tmp.path].none)).toEqual(["."])
  expect((await offer(tmp.path, "Yes")).asked).toHaveLength(0)
  await shadcn(tmp.path)
  const found = await offer(tmp.path, "No")
  expect(found.asked).toHaveLength(1)
  expect(found.outcome.status).toBe("declined")
})

test("an application outside the project is never read, asked about or written", async () => {
  await using tmp = await tmpdir()
  await using outside = await tmpdir()
  await shadcn(outside.path)
  await mkdir(path.join(tmp.path, ".git"), { recursive: true })
  await symlink(outside.path, path.join(tmp.path, "linked"), "dir")
  for (const application of ["../outside", outside.path, "linked"]) {
    const { outcome, asked } = await offer(tmp.path, "Yes", { application })
    expect(outcome.status).toBe("none")
    expect(asked).toHaveLength(0)
  }
  expect(await Bun.file(path.join(outside.path, ".red/DESIGN.md")).exists()).toBe(false)
  expect(await DesignProposal.detection({ directory: tmp.path, application: "../outside" })).toBe(
    "Design system detection: ../outside is not a directory inside the project.",
  )
})

test("concurrent sessions share one question per project", async () => {
  await using tmp = await tmpdir()
  await shadcn(tmp.path)
  const state = path.join(tmp.path, ".state", DesignProposal.STATE)
  const release = Promise.withResolvers<string>()
  let asked = 0
  const decide = () =>
    Effect.runPromise(
      DesignProposal.decide({
        directory: tmp.path,
        state,
        configured: false,
        ask: () =>
          Effect.promise(() => {
            asked++
            return release.promise
          }),
      }),
    )
  const first = decide()
  await Bun.sleep(50)
  const second = decide()
  release.resolve("No")
  expect((await first).status).toBe("declined")
  expect((await second).status).toBe("declined")
  expect(asked).toBe(1)
})

test("around writes the config only after the operation succeeds and forgets a failed adoption", async () => {
  await using tmp = await tmpdir()
  await shadcn(tmp.path)
  const adopted: (ConfigDesign.Effective | undefined)[] = []
  const input = {
    directory: tmp.path,
    state: path.join(tmp.path, ".state", DesignProposal.STATE),
    configured: false,
    ask: () => Effect.succeed("Yes"),
    adopt: (design: ConfigDesign.Effective | undefined) => Effect.sync(() => void adopted.push(design)),
  }
  const failed = await Effect.runPromiseExit(
    DesignProposal.around(
      input,
      Effect.suspend(() => {
        expect(adopted.at(-1)?.system?.paths).toEqual(["src/components"])
        return Effect.fail("create failed")
      }),
    ),
  )
  expect(failed._tag).toBe("Failure")
  expect(adopted.at(-1)).toBeUndefined()
  expect(await Bun.file(path.join(tmp.path, "redcode.json")).exists()).toBe(false)

  const succeeded = await Effect.runPromise(DesignProposal.around(input, Effect.succeed("created")))
  expect(succeeded.value).toBe("created")
  expect(succeeded.report).toContain("wrote design.system to redcode.json")
  expect(adopted.at(-1)?.system?.paths).toEqual(["src/components"])
  expect(JSON.parse(await Bun.file(path.join(tmp.path, "redcode.json")).text()).design.system).toEqual(system)
})

test("detection reports the evidence and configuration state without asking or writing", async () => {
  await using tmp = await tmpdir()
  await shadcn(tmp.path)
  const report = await DesignProposal.detection({ directory: tmp.path })
  expect(report).toStartWith("Design system detection (nothing was written):\nApplication: project root")
  expect(report).toContain("Evidence:\n- application: single package: package.json declares a UI framework")
  expect(report).toContain("- paths: src/components holds component files")
  expect(report).toContain("design.system is not configured; design_document create or refresh asks the user")
  expect(await Bun.file(path.join(tmp.path, "redcode.json")).exists()).toBe(false)
})

test("REDCODE_DESIGN_BROWSER wins over design.browser, which wins over the built-in choice", () => {
  expect(DesignBrowserLauncher.browser({ REDCODE_DESIGN_BROWSER: "firefox" }, "chromium")).toBe("firefox")
  expect(DesignBrowserLauncher.browser({ REDCODE_DESIGN_BROWSER: "  " }, " chromium ")).toBe("chromium")
  expect(DesignBrowserLauncher.browser({}, "default")).toBe("default")
  expect(DesignBrowserLauncher.browser({})).toBeUndefined()
})
