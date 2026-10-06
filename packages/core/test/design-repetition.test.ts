/// <reference lib="dom" />
import { describe, expect } from "bun:test"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { parseHTML } from "linkedom"
import { Effect, Layer } from "effect"
import { Design } from "@opencode/schema/design"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Config } from "../src/config"
import { Database } from "../src/database/database"
import { DesignFiles } from "../src/design/files"
import { DesignJudge } from "../src/design/judge"
import { DesignSignature } from "../src/design/signature"
import { DesignStore } from "../src/design/store"
import { Intelligence, type EvaluationInput } from "../src/intelligence"
import { IntelligenceEvaluation } from "../src/intelligence/evaluation"
import { Location } from "../src/location"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const project = Project.ID.make("design-repetition")
const sessionID = Session.ID.make("ses_design_repetition")

const single: IntelligenceEvaluation.ScopedSettings = { enabled: false, onboarding: "completed", sessionReasoning: "single" }
const dual: IntelligenceEvaluation.ScopedSettings = {
  enabled: true,
  onboarding: "completed",
  sessionReasoning: "dual",
  principal: { providerID: Provider.ID.make("fake"), id: Model.ID.make("fake-model") },
  evaluator: IntelligenceEvaluation.evaluatorPreset("red-router"),
}

/** System One as the store meets it: the settings, a probability per question (or a failure), and every request sent. */
const systemOne = {
  settings: single,
  answer: (() => ({})) as (input: EvaluationInput) => Record<string, number> | "failure",
  asked: [] as EvaluationInput[],
  active: 0,
  peak: 0,
}
const reasoning = (settings: IntelligenceEvaluation.ScopedSettings, answer: typeof systemOne.answer = () => ({})) =>
  Effect.sync(() => Object.assign(systemOne, { settings, answer, asked: [], active: 0, peak: 0 }))

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Location.node, DesignStore.node]), [
    Location.node.replace(tempLocationLayer),
    Config.node.replace(Config.testLayer()),
    Intelligence.node.replace(
      Layer.mock(Intelligence.Service, {
        read: () => Effect.succeed(systemOne.settings),
        evaluate: (input) =>
          Effect.gen(function* () {
            systemOne.asked.push(input)
            systemOne.peak = Math.max(systemOne.peak, ++systemOne.active)
            yield* Effect.sleep("10 millis")
            systemOne.active--
            const answered = systemOne.answer(input)
            if (answered === "failure") return yield* new IntelligenceEvaluation.Error({ message: "System One did not answer" })
            const answers = Object.fromEntries(
              Object.keys(input.questions).map((id) => [id, { type: "noul" as const, noul: answered[id] ?? 0.05 }]),
            )
            const usage = { input_tokens: 0, output_tokens: 0 }
            return {
              id: `evaluation_${systemOne.asked.length}`,
              fingerprint: "fingerprint",
              sessionID: input.sessionID,
              operation: input.operation,
              kind: "gate" as const,
              policy: IntelligenceEvaluation.POLICY,
              model: "jev",
              answers,
              ...IntelligenceEvaluation.decide(input.questions, { model: "jev", answers, usage }, input.operation),
              created: 0,
              duration: 0,
              usage,
            }
          }),
      }),
    ),
  ]),
)

const seed = Effect.gen(function* () {
  const database = yield* Database.Service
  const location = yield* Location.Service
  yield* database.db.insert(ProjectTable).values({ id: project, worktree: location.directory, sandboxes: [] }).run().pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({ id: sessionID, project_id: project, directory: location.directory, slug: "design", agent: "design", version: "test" })
    .run()
    .pipe(Effect.orDie)
  return location.directory
})

const reader = (element: Element): DesignSignature.Style => {
  const declared = Object.fromEntries(
    (element.getAttribute("style") ?? "")
      .split(";")
      .map((part) => part.split(":"))
      .filter((part) => part.length >= 2)
      .map(([name, ...value]) => [name!.trim(), value.join(":").trim()]),
  )
  return {
    display: declared.display ?? "block",
    gridTemplateColumns: declared["grid-template-columns"] ?? "none",
    flexDirection: declared["flex-direction"] ?? "row",
    color: "rgb(17, 24, 39)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    fontFamily: "Inter, sans-serif",
  }
}
const direction = (id: string, title: string) =>
  `<div data-design-variant="${id}"><header style="display:flex"><a>${title}</a><nav style="display:flex"><a>1</a><a>2</a><a>3</a></nav></header><main><section><h1>${title}</h1><p>${title} lead</p></section><section style="display:grid;grid-template-columns:repeat(3, 1fr)">${[1, 2, 3]
    .map((index) => `<article><h2>${title} ${index}</h2><p>Body</p><button>Go</button></article>`)
    .join("")}</section></main><footer><p>Legal</p></footer></div>`
const rendered = parseHTML(`<!doctype html><html><body>${direction("calm", "Calm")}${direction("bold", "Negrito")}</body></html>`)
  .document as unknown as Document
const signatures = ["calm", "bold"].map((variant) => ({
  variant,
  width: 1440,
  signature: DesignSignature.capture(variant, rendered, reader),
}))

/** A react revision whose sources re-declare the design system's Card, stored like a published one. */
const revision = Effect.fn("test.revision")(function* () {
  const store = yield* DesignStore.Service
  const created = yield* store.create(sessionID, { name: "Shop", journey: "new", engine: "react", kind: "screen" })
  const source = 'import { Button } from "@/components/ui/button"\nexport function Card() {\n  return <Button />\n}\n'
  const bytes = new TextEncoder().encode(source)
  const hash = DesignFiles.hash(bytes)
  yield* Effect.promise(async () => {
    await mkdir(store.blobs, { recursive: true })
    await writeFile(path.join(store.blobs, hash), bytes)
  })
  const document: Design.Info = {
    ...created,
    system: { paths: ["src/components/ui"], css: [], tailwind: false, aliases: { "@/": "./src/" } },
    inventory: [
      { root: "src/components/ui", file: "src/components/ui/button.tsx", name: "Button" },
      { root: "src/components/ui", file: "src/components/ui/card.tsx", name: "Card" },
    ],
  }
  return { id: "rev_shop", designID: created.id, parent: null, name: "Shop", created: 1, files: { "src/main.tsx": hash }, document } satisfies Design.Revision
})

const rules = (checks: readonly Design.AuditCheck[]) =>
  checks.map((check) => [check.rule, check.severity, check.judged]).toSorted((a, b) => String(a[0]).localeCompare(String(b[0])))

describe("DesignStore.repetition", () => {
  it.live("reports deterministic findings without asking System One under single reasoning", () =>
    Effect.gen(function* () {
      yield* seed
      yield* reasoning(single)
      const store = yield* DesignStore.Service
      const result = yield* store.repetition(sessionID, yield* revision(), signatures, 1440)
      expect(systemOne.asked).toEqual([])
      expect(rules(result.checks)).toEqual([
        ["redeclared-component", "review", undefined],
        ["variants-too-similar", "review", undefined],
      ])
      expect(result.reuse).toEqual({ imported: ["Button"], redeclared: ["Card"], files: ["src/components/ui/button.tsx"], ratio: 0.5 })
    }),
  )

  it.live("asks one request with a question per flagged item, keeps confirmed findings and downgrades rejected ones", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* DesignStore.Service
      const recorded = yield* revision()
      // Yes for the repeated variants, no for the re-declared component.
      yield* reasoning(dual, (input) => {
        const candidate = input.candidate as ReadonlyArray<{ item: number; finding: string }>
        return Object.fromEntries(candidate.map((item) => [`item_${item.item}`, item.finding === "variants-too-similar" ? 0.95 : 0.05]))
      })
      const result = yield* store.repetition(sessionID, recorded, signatures, 1440)
      expect(systemOne.asked).toHaveLength(1)
      const asked = systemOne.asked[0]!
      expect(asked.operation).toBe("design_completion")
      expect(Object.keys(asked.questions).toSorted()).toEqual(["item_0", "item_1"])
      expect(JSON.stringify(asked).length).toBeLessThanOrEqual(80_000)
      // Only structural evidence: signatures and component code, never the variants' copy beyond the source.
      expect(JSON.stringify(asked.sources)).toContain("landmarks")
      expect(rules(result.checks)).toEqual([
        ["redeclared-component", "info", "rejected"],
        ["variants-too-similar", "review", "confirmed"],
      ])
    }),
  )

  it.live("keeps every finding, marked unconfirmed, when System One does not answer", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* DesignStore.Service
      const recorded = yield* revision()
      yield* reasoning(dual, () => "failure")
      const result = yield* store.repetition(sessionID, recorded, signatures, 1440)
      expect(systemOne.asked).toHaveLength(1)
      expect(rules(result.checks)).toEqual([
        ["redeclared-component", "review", "unconfirmed"],
        ["variants-too-similar", "review", "unconfirmed"],
      ])
      expect(result.checks.every((check) => check.evidence.includes("unconfirmed: System One unavailable"))).toBe(true)
    }),
  )

  it.live("sends nothing in observe mode", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* DesignStore.Service
      const recorded = yield* revision()
      yield* reasoning({ ...dual, sessionReasoning: "observe" })
      const result = yield* store.repetition(sessionID, recorded, signatures, 1440)
      expect(systemOne.asked).toEqual([])
      expect(rules(result.checks)).toEqual([
        ["redeclared-component", "review", undefined],
        ["variants-too-similar", "review", undefined],
      ])
    }),
  )

  it.live("does not judge an accepted key, reuses verdicts for unchanged evidence and never sends source text", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* DesignStore.Service
      const recorded = yield* revision()
      // Accepted on the live document after this revision was published.
      yield* store.update(sessionID, recorded.designID, {
        decisions: [{ id: "accept:variants-too-similar@calm~bold", text: "Two takes on one grid, on purpose." }],
      })
      yield* reasoning(dual, () => ({ item_0: 0.95 }))
      const first = yield* store.repetition(sessionID, recorded, signatures, 1440)
      expect(systemOne.asked).toHaveLength(1)
      expect((systemOne.asked[0]!.candidate as ReadonlyArray<{ key: string }>).map((item) => item.key)).toEqual([
        "redeclared-component@Card",
      ])
      const sent = JSON.stringify(systemOne.asked[0]!.sources)
      expect(sent).toContain("Button")
      expect(sent).not.toContain("return")
      expect(rules(first.checks)).toEqual([
        ["redeclared-component", "review", "confirmed"],
        ["variants-too-similar", "review", undefined],
      ])
      // The same evidence again: the verdict is reused and nothing is sent.
      yield* reasoning(dual, () => ({ item_0: 0.95 }))
      const second = yield* store.repetition(sessionID, recorded, signatures, 1440)
      expect(systemOne.asked).toEqual([])
      expect(rules(second.checks)).toEqual(rules(first.checks))
    }),
  )

  it.live("degrades a failing reuse check to one info check and reports an unreadable approvals file", () =>
    Effect.gen(function* () {
      yield* seed
      yield* reasoning(single)
      const store = yield* DesignStore.Service
      const recorded = yield* revision()
      yield* Effect.promise(async () => {
        await mkdir(path.join(recorded.document.application, ".red"), { recursive: true })
        await writeFile(path.join(recorded.document.application, DesignSignature.FILE), "{ broken")
      })
      // An inventory entry without a file is a defect inside the check, never a failed audit.
      const broken = {
        ...recorded,
        document: { ...recorded.document, inventory: [{ root: "src", file: undefined, name: "Card" } as unknown as Design.Component] },
      }
      const result = yield* store.repetition(sessionID, broken, signatures, 1440)
      expect(rules(result.checks)).toEqual([
        ["reuse-check-unavailable", "info", undefined],
        ["variants-too-similar", "review", undefined],
      ])
      expect(result.findings).toEqual([expect.stringContaining("Approved designs: .red/design-signatures.json is unreadable")])
    }),
  )

  it.live("splits more than twenty flagged items into requests sent together", () =>
    Effect.sync(() => {
      const subjects = Array.from({ length: 45 }, (_, index) => ({
        key: `redeclared-component@C${index}`,
        rule: "redeclared-component",
        source: { name: `C${index}`, code: "x".repeat(5_000) },
        question: "Duplicate?",
      }))
      const requests = DesignJudge.requests(subjects)
      expect(requests.map((request) => request.batch.length)).toEqual([20, 20, 5])
      // What each request sends: bounded evidence per item, never the raw sources.
      for (const request of requests)
        expect(
          JSON.stringify({ sources: request.sources, candidate: request.candidate, questions: request.questions }).length,
        ).toBeLessThanOrEqual(80_000)
    }),
  )
})
