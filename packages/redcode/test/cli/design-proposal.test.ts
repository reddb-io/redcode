import { expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { DesignProposalPrompt } from "../../src/cli/design-proposal"

async function project() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "redcode-design-proposal-")))
  const files: Record<string, string> = {
    ".git/HEAD": "ref: refs/heads/main\n",
    "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
    "src/index.css": ":root { --brand: #0a7; }\n",
    "src/components/Button.tsx": "export function Button() { return <button /> }\n",
  }
  for (const [file, content] of Object.entries(files)) await Bun.write(path.join(root, file), content)
  return {
    root,
    global: path.join(root, ".global"),
    state: path.join(root, ".state", "proposal.json"),
    async [Symbol.asyncDispose]() {
      await rm(root, { recursive: true, force: true })
    },
  }
}

test("redcode design offers the detected system once and writes it on yes, keeping design.browser", async () => {
  await using fixture = await project()
  await Bun.write(path.join(fixture.root, "redcode.json"), `{\n  "design": { "browser": "firefox" }\n}\n`)
  const output: string[] = []
  const prompts: string[] = []
  const result = await DesignProposalPrompt.run({
    directory: fixture.root,
    global: fixture.global,
    state: fixture.state,
    write: (text) => output.push(text),
    ask: async (query) => {
      prompts.push(query)
      return "y"
    },
  })
  expect(prompts).toEqual(["Use detected design system? [y]es / [e]dit later / [n]o: "])
  expect(output[0]).toContain("Components: src/components")
  expect(output[0]).toContain("  1) Yes: Write the design section into redcode.json")
  expect(result.outcome.status).toBe("adopted")
  expect(output.at(-1)).toStartWith("Wrote design.system to redcode.json.")
  expect(result.browser).toBe("firefox")
  const config = JSON.parse(await Bun.file(path.join(fixture.root, "redcode.json")).text())
  expect(config.design).toEqual({
    browser: "firefox",
    system: { paths: ["src/components"], css: ["src/index.css"], tailwind: false, framework: "react" },
  })

  const again = await DesignProposalPrompt.run({
    directory: fixture.root,
    global: fixture.global,
    state: fixture.state,
    write: (text) => output.push(text),
    ask: async () => {
      throw new Error("a configured project must not be asked")
    },
  })
  expect(again.outcome.status).toBe("configured")
})

test("no is remembered across runs and a dismissed prompt only postpones", async () => {
  await using fixture = await project()
  const ask = (reply: string | undefined) => async () => reply
  const run = (reply: string | undefined) =>
    DesignProposalPrompt.run({
      directory: fixture.root,
      global: fixture.global,
      state: fixture.state,
      write: () => {},
      ask: ask(reply),
    })
  expect((await run(undefined)).outcome.status).toBe("later")
  expect((await run("y")).outcome.status).toBe("snoozed")
  await rm(fixture.state)
  expect((await run("n")).outcome.status).toBe("declined")
  expect((await run("y")).outcome.status).toBe("dismissed")
  expect(await Bun.file(path.join(fixture.root, "redcode.json")).exists()).toBe(false)
})

test("typed replies map to the proposal options", () => {
  expect(DesignProposalPrompt.choice(" Y ")).toBe("Yes")
  expect(DesignProposalPrompt.choice("3")).toBe("No")
  expect(DesignProposalPrompt.choice("")).toBe("Edit later")
  expect(DesignProposalPrompt.choice(undefined)).toBe("Edit later")
})
