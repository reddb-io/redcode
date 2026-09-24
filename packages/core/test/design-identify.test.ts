import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, symlink } from "node:fs/promises"
import { Effect } from "effect"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { DesignIdentify } from "../src/design/identify"
import { DesignProposal } from "../src/design/proposal"
import { Intelligence } from "../src/intelligence"
import { tmpdir } from "./fixture/tmpdir"

type Questions = Record<string, { readonly criteria: Record<string, unknown> }>
type Picks = Record<string, readonly [string, number]>

const project = async (root: string, extra: Record<string, string> = {}) => {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "web", dependencies: { react: "^19.0.0", tailwindcss: "^3.4.0" } }),
    "tailwind.config.ts": "export default { theme: { extend: { colors: { brand: '#f00' } } } }\n",
    "src/styles/globals.css": "@tailwind base;\n:root {\n  --primary: #111;\n}\n",
    "src/components/Button.tsx": "export function Button() { return <button /> }\n",
    ...extra,
  }
  for (const [file, content] of Object.entries(files)) await Bun.write(path.join(root, file), content)
  // A repository root bounds the static config walk so the test never reads the host's files.
  await mkdir(path.join(root, ".git"), { recursive: true })
}

/** Answers every question System One was asked, with the picked label or the first one. */
const reply = (picks: Picks) => (body: { questions: Questions }) =>
  Response.json({
    model: "jev-test",
    answers: Object.fromEntries(
      Object.entries(body.questions).map(([id, question]) => {
        const labels = Object.keys(question.criteria)
        const [choice, confidence] = picks[id] ?? [labels[0]!, 0.9]
        const rest = labels.filter((label) => label !== choice)
        return [
          id,
          {
            type: "choice",
            choice,
            confidence,
            probabilities: Object.fromEntries([
              [choice, rest.length ? confidence : 1],
              ...rest.map((label) => [label, (1 - confidence) / rest.length]),
            ]),
          },
        ]
      }),
    ),
    usage: { input_tokens: 40, output_tokens: 8 },
  })

const credentials = {
  get: () => Effect.succeed(undefined),
  list: () => Effect.succeed([]),
  create: () => Effect.die("Credential creation not expected"),
}

const settings = {
  enabled: true,
  reasoning: "dual" as const,
  onboarding: "completed" as const,
  principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
  evaluator: { transport: "typesafe" as const, baseURL: "https://api.typesafe.ai/v1", model: "jev-test" },
}

/** An S1 service backed by a fake transport; `requests` records every System One request body. */
const service = (root: string, respond: (body: never) => Response, reasoning: "single" | "dual" = "dual") =>
  Effect.gen(function* () {
    const requests: { questions: Questions; state: { sources: unknown } }[] = []
    const intelligence = yield* Intelligence.make(
      root,
      credentials,
      Object.assign(
        (_url: string | URL | Request, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}"))
          requests.push(body)
          return Promise.resolve(respond(body as never))
        },
        { preconnect() {} },
      ),
    )
    yield* intelligence.save({ settings: { ...settings, reasoning } })
    return { intelligence, requests }
  })

const identify = (
  directory: string,
  state: string,
  intelligence: Intelligence.Interface,
  options: { answer?: DesignIdentify.Answer; counter?: { calls: number } } = {},
) =>
  Effect.gen(function* () {
    const mode = Intelligence.mode(yield* intelligence.read())
    return yield* DesignIdentify.identify({
      directory,
      state,
      mode,
      sessionID: "ses_design_identify",
      answer: options.answer,
      evaluate: (evaluation) => {
        if (options.counter) options.counter.calls++
        return intelligence.evaluate(evaluation)
      },
    })
  })

describe("evidence pack", () => {
  test("respects its caps, prunes dependencies and build output, and never executes configuration", async () => {
    await using tmp = await tmpdir()
    const marker = path.join(tmp.path, "executed.txt")
    await project(tmp.path, {
      "tailwind.config.js": `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")\nmodule.exports = {}\n`,
      "node_modules/lib/tokens.css": ":root { --vendored: red; }\n",
      "dist/app.css": ":root { --built: red; }\n",
      ...Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [
          `src/themes/theme-${index}.css`,
          `:root {\n${Array.from({ length: 200 }, (_, line) => `  --token-${line}: #${String(line).padStart(6, "0")};`).join("\n")}\n}\n`,
        ]),
      ),
    })
    const pack = await DesignIdentify.collect(tmp.path)
    const paths = pack.files.map((file) => file.path)
    expect(paths.some((file) => file.startsWith("node_modules/") || file.startsWith("dist/"))).toBe(false)
    expect(pack.tree).not.toContain("node_modules")
    expect(pack.tree).not.toContain("dist/")
    expect(pack.tree).not.toContain(".git")
    expect(pack.files.reduce((total, file) => total + file.excerpt.length, 0)).toBeLessThanOrEqual(24_000)
    expect(pack.files.every((file) => file.excerpt.length <= 1600 + "\n[... excerpt truncated]".length)).toBe(true)
    expect(pack.truncated).toBe(true)
    // Configuration is text in the pack, never loaded.
    expect(pack.files.find((file) => file.path === "tailwind.config.js")?.excerpt).toContain("writeFileSync")
    expect(await Bun.file(marker).exists()).toBe(false)
    expect(DesignIdentify.render(pack)).toContain("--- tailwind.config.js (tailwind) ---")
  })

  test("stays inside the project: symlinked directories and files are ignored", async () => {
    await using tmp = await tmpdir()
    await using outside = await tmpdir()
    await project(tmp.path)
    await Bun.write(path.join(outside.path, "tokens.css"), ":root { --secret: red; }\n")
    await Bun.write(path.join(outside.path, "components/Leak.tsx"), "export const Leak = () => null\n")
    await symlink(outside.path, path.join(tmp.path, "linked"), "dir")
    await symlink(path.join(outside.path, "tokens.css"), path.join(tmp.path, "src/styles/escape.css"))
    const pack = await DesignIdentify.collect(tmp.path)
    expect(pack.tree).not.toContain("linked")
    expect(pack.tree).not.toContain("escape.css")
    expect(JSON.stringify(pack)).not.toContain("--secret")
    expect(pack.candidates.components.map((item) => item.path)).toEqual(["src/components"])
  })
})

describe("dual reasoning", () => {
  test("System One confirms the heuristic proposal", async () => {
    await using tmp = await tmpdir()
    await using state = await tmpdir()
    await project(tmp.path)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const s1 = yield* service(
          state.path,
          reply({
            present: ["yes", 0.95],
            kind: ["tailwind", 0.9],
            library: ["own", 0.8],
            framework: ["react", 0.9],
            components: ["src/components", 0.9],
            css: ["src/styles/globals.css", 0.9],
          }),
        )
        const identified = yield* identify(tmp.path, path.join(state.path, DesignIdentify.STATE), s1.intelligence)
        return { identified, requests: s1.requests }
      }),
    )
    expect(result.requests).toHaveLength(1)
    expect(Object.keys(result.requests[0]!.questions).toSorted()).toEqual([
      "components",
      "css",
      "framework",
      "kind",
      "library",
      "present",
    ])
    expect(JSON.stringify(result.requests[0]!.state.sources)).toContain("--primary")
    const identified = result.identified
    expect(identified).toMatchObject({ source: "system-one", verified: true, kind: "tailwind", library: "own" })
    expect(identified.proposal?.system).toEqual({
      paths: ["src/components"],
      css: ["src/styles/globals.css"],
      tailwind: true,
      framework: "react",
    })
    expect(identified.notes.join("\n")).toContain("System One confirmed the component directories")
    expect(DesignIdentify.headline(identified)).toBe(
      "Design system: Tailwind theme (own components) at src/components, src/styles/globals.css (95%, System One)",
    )
  })

  test("System One corrects heuristic fields with paths that exist inside the project", async () => {
    await using tmp = await tmpdir()
    await using state = await tmpdir()
    await project(tmp.path, {
      "src/primitives/Box.tsx": "export const Box = () => null\n",
      "src/theme/tokens.css": ":root {\n  --brand: #f00;\n  --space-1: 4px;\n}\n",
    })
    const identified = await Effect.runPromise(
      Effect.gen(function* () {
        const s1 = yield* service(
          state.path,
          reply({
            present: ["yes", 0.9],
            kind: ["tokens", 0.8],
            library: ["own", 0.8],
            framework: ["react", 0.9],
            components: ["src/primitives", 0.85],
            css: ["src/theme/tokens.css", 0.8],
          }),
        )
        return yield* identify(tmp.path, path.join(state.path, DesignIdentify.STATE), s1.intelligence)
      }),
    )
    expect(identified.proposal?.system.paths).toEqual(["src/primitives"])
    expect(identified.proposal?.system.css).toEqual(["src/theme/tokens.css"])
    expect(identified.kind).toBe("tokens")
    expect(identified.notes).toContain(
      "System One corrected the component directories: src/components → src/primitives",
    )
    expect(identified.proposal?.fields.paths.evidence.at(-1)).toBe("corrected by System One")
  })

  test("System One rejects the heuristic proposal and the user is asked nothing", async () => {
    await using tmp = await tmpdir()
    await using state = await tmpdir()
    await project(tmp.path)
    const asked: string[] = []
    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const s1 = yield* service(state.path, reply({ present: ["no", 0.9] }))
        return yield* DesignProposal.decide({
          directory: tmp.path,
          state: path.join(state.path, DesignProposal.STATE),
          configured: false,
          identify: () => identify(tmp.path, path.join(state.path, DesignIdentify.STATE), s1.intelligence),
          ask: (request) =>
            Effect.sync(() => {
              asked.push(request.question)
              return "Yes"
            }),
        })
      }),
    )
    expect(asked).toHaveLength(0)
    expect(decision.status).toBe("none")
    expect(decision.identification?.notes.join("\n")).toContain("System One rejected the heuristic proposal")
    expect(DesignProposal.report(decision, tmp.path)).toStartWith("Design system: none found (")
  })

  test("a System One failure falls back to the heuristic, labeled unverified, in the question", async () => {
    await using tmp = await tmpdir()
    await using state = await tmpdir()
    await project(tmp.path)
    const asked: string[] = []
    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const s1 = yield* service(state.path, () => Response.json({ error: "down" }, { status: 500 }))
        return yield* DesignProposal.decide({
          directory: tmp.path,
          state: path.join(state.path, DesignProposal.STATE),
          configured: false,
          identify: () => identify(tmp.path, path.join(state.path, DesignIdentify.STATE), s1.intelligence),
          ask: (request) =>
            Effect.sync(() => {
              asked.push(request.question)
              return "Edit later"
            }),
        })
      }),
    )
    expect(decision.status).toBe("later")
    expect(decision.identification).toMatchObject({ source: "heuristic", verified: false })
    expect(decision.identification?.reason).toContain("System One could not answer")
    expect(asked).toHaveLength(1)
    expect(asked[0]).toStartWith("Use detected design system?\nDesign system: Tailwind theme")
    expect(asked[0]).toContain(", heuristic, unverified)")
    expect(asked[0]).toContain("Why: System One could not answer")
    // An unverified result is not cached: the next design tries System One again.
    expect(await Bun.file(path.join(state.path, DesignIdentify.STATE)).exists()).toBe(false)
  })

  test("the result is cached until the scanned tree changes", async () => {
    await using tmp = await tmpdir()
    await using state = await tmpdir()
    await project(tmp.path)
    const counter = { calls: 0 }
    const file = path.join(state.path, DesignIdentify.STATE)
    await Effect.runPromise(
      Effect.gen(function* () {
        const s1 = yield* service(state.path, reply({ present: ["yes", 0.9] }))
        const first = yield* identify(tmp.path, file, s1.intelligence, { counter })
        const second = yield* identify(tmp.path, file, s1.intelligence, { counter })
        expect(second).toEqual(first)
        expect(counter.calls).toBe(1)
        yield* Effect.promise(() =>
          Bun.write(path.join(tmp.path, "src/components/Card.tsx"), "export const Card = () => null\n"),
        )
        yield* identify(tmp.path, file, s1.intelligence, { counter })
        expect(counter.calls).toBe(2)
      }),
    )
  })

  test("a project without any design evidence asks System One and the user nothing", async () => {
    await using tmp = await tmpdir()
    await using state = await tmpdir()
    await mkdir(path.join(tmp.path, ".git"), { recursive: true })
    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ name: "cli" }))
    await Bun.write(path.join(tmp.path, "src/index.ts"), "console.log('hi')\n")
    const counter = { calls: 0 }
    const asked: string[] = []
    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const s1 = yield* service(state.path, reply({}))
        return yield* DesignProposal.decide({
          directory: tmp.path,
          state: path.join(state.path, DesignProposal.STATE),
          configured: false,
          identify: () => identify(tmp.path, path.join(state.path, DesignIdentify.STATE), s1.intelligence, { counter }),
          ask: (request) =>
            Effect.sync(() => {
              asked.push(request.question)
              return "Yes"
            }),
        })
      }),
    )
    expect(counter.calls).toBe(0)
    expect(asked).toHaveLength(0)
    expect(decision.status).toBe("none")
    expect(DesignProposal.report(decision, tmp.path)).toContain("design from the brief")
  })
})

describe("single reasoning", () => {
  test("makes no System One call and merges the design agent's structured answer", async () => {
    await using tmp = await tmpdir()
    await using state = await tmpdir()
    await project(tmp.path, {
      "src/primitives/Box.tsx": "export const Box = () => null\n",
      "src/theme/tokens.css": ":root {\n  --brand: #f00;\n}\n",
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const s1 = yield* service(state.path, reply({}), "single")
        const identified = yield* identify(tmp.path, path.join(state.path, DesignIdentify.STATE), s1.intelligence, {
          answer: {
            present: true,
            kind: "components",
            library: "own",
            components: ["src/primitives", "../escape", "src/missing"],
            css: ["src/theme/tokens.css"],
            framework: "react",
            confidence: 0.8,
            reason: "src/primitives holds the shared components and src/theme/tokens.css the tokens",
          },
        })
        return { identified, requests: s1.requests }
      }),
    )
    expect(result.requests).toHaveLength(0)
    expect(result.identified).toMatchObject({
      source: "agent",
      verified: true,
      kind: "components",
      reason: "src/primitives holds the shared components and src/theme/tokens.css the tokens",
    })
    expect(result.identified.proposal?.system.paths).toEqual(["src/primitives"])
    expect(result.identified.proposal?.system.css).toEqual(["src/theme/tokens.css"])
    expect(result.identified.notes.join("\n")).toContain("../escape, src/missing")
    expect(DesignIdentify.headline(result.identified)).toContain("(80%, design agent)")
  })

  test("without the agent's answer the heuristic stands, unverified, still without System One", async () => {
    await using tmp = await tmpdir()
    await using state = await tmpdir()
    await project(tmp.path)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const s1 = yield* service(state.path, reply({}), "single")
        const identified = yield* identify(tmp.path, path.join(state.path, DesignIdentify.STATE), s1.intelligence)
        return { identified, requests: s1.requests }
      }),
    )
    expect(result.requests).toHaveLength(0)
    expect(result.identified).toMatchObject({ source: "heuristic", verified: false })
    expect(result.identified.proposal?.system.paths).toEqual(["src/components"])
  })

  test("detect hands the design agent the evidence pack", async () => {
    await using tmp = await tmpdir()
    await project(tmp.path)
    const report = await DesignProposal.detection({ directory: tmp.path, pack: true })
    expect(report).toContain("Evidence pack")
    expect(report).toContain("--- src/styles/globals.css (stylesheet) ---")
    expect(report).toContain("pass your conclusion as system on design_document create")
  })
})

test("a configured system whose paths are gone is stale", async () => {
  await using tmp = await tmpdir()
  await project(tmp.path)
  expect(
    await DesignProposal.stale(tmp.path, { system: { paths: ["src/components"], css: ["src/styles/globals.css"] } }),
  ).toBe(false)
  expect(await DesignProposal.stale(tmp.path, { system: { paths: ["src/removed"] } })).toBe(true)
  expect(await DesignProposal.stale(tmp.path, undefined)).toBe(false)
})
