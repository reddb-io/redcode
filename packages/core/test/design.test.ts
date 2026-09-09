import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { parseGIF, decompressFrames } from "gifuct-js"
import { chromium } from "playwright-core"
import { designDependencies } from "./fixture/design-dependencies"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { DesignStore } from "../src/design/store"
import { DesignContext } from "../src/design/context"
import { SystemContext } from "../src/system-context"
import { DesignFiles } from "../src/design/files"
import { DesignAssets } from "../src/design/assets"
import { DesignQuality } from "../src/design/quality"
import { DesignRenderer } from "../src/design/renderer"
import { DesignExport } from "../src/design/export"
import { Location } from "../src/location"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionV2 } from "../src/session"
import { SessionMessage } from "../src/session/message"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([DesignStore.node, DesignRenderer.node, Database.node, Location.node]), [
    [Location.node, tempLocationLayer],
  ]),
)
const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  const location = yield* Location.Service
  const store = yield* DesignStore.Service
  const sessionID = SessionV2.ID.make(`ses_${crypto.randomUUID()}`)
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "design-test",
      directory: location.directory,
      title: "Design",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return {
    store,
    document: yield* store.create(sessionID, { name: "Checkout", journey: "new", engine: "html", kind: "screen" }),
  }
})

describe("Design revisions and review", () => {
  it.effect("sessions without Design documents do not add empty guidance", () =>
    Effect.gen(function* () {
      const source = yield* DesignContext.load(SessionV2.ID.make("ses_without_design"))
      const generation = yield* SystemContext.initialize(source)
      expect(generation.baseline).toBe("")
      expect(yield* SystemContext.reconcile(source, generation.snapshot)).toMatchObject({ _tag: "Unchanged" })
    }),
  )

  it.effect("approved context survives new drafts and fresh context generations without replaying review history", () =>
    Effect.gen(function* () {
      const { store, document } = yield* setup
      yield* store.update(document.id, {
        brief: {
          objective: "Accessible checkout",
          audience: "Cashiers",
          content: "",
          constraints: "No external fonts; preserve keyboard navigation",
          references: [],
        },
        decisions: [{ id: "palette", text: "Use the Stone palette" }],
        scenarios: [
          {
            id: "empty",
            name: "Empty cart",
            state: "empty",
            selector: "#cart",
            actions: [{ action: "click", selector: "#clear" }],
          },
        ],
      })
      yield* Effect.promise(() =>
        Bun.write(`${document.root}/index.html`, '<section data-design-variant="stone">Approved Stone</section>'),
      )
      const first = yield* store.publish(document.id, "Two directions")
      const feedback = {
        id: SessionMessage.ID.create(),
        revision: first.id,
        text: "Choose Stone",
        items: [],
        assets: [],
        snapshot: "OBSOLETE SCREEN CONTENT ".repeat(4000),
        delivery: "queue" as const,
        end: false,
      }
      yield* store.prepareFeedback(document.id, feedback)
      yield* store.acknowledge(document.id, feedback)
      const variant = { id: "stone", name: "Stone" }
      yield* store.approve(document.id, first.id, variant)
      const frozen = yield* Effect.promise(() => Bun.file(`${document.root}/../approvals/${first.id}.json`).text())
      expect((yield* store.approval(document.id)).variant).toEqual(variant)
      const source = yield* DesignContext.load(document.sessionID)
      const initial = yield* SystemContext.initialize(source)
      expect(initial.baseline).toContain("Use the Stone palette")
      expect(initial.baseline).toContain("No external fonts; preserve keyboard navigation")
      expect(initial.baseline).toContain("click #clear")
      expect(initial.baseline).not.toContain("OBSOLETE SCREEN CONTENT")
      expect(Array.isArray(initial.snapshot["design/session"].value)).toBe(true)
      expect(initial.baseline.length).toBeLessThan(frozen.length / 5)
      const legacyContext = yield* SystemContext.reconcile(source, {
        "design/session": { value: "Legacy mutable Design context" },
      })
      expect(legacyContext).toMatchObject({ _tag: "ReplacementReady" })
      expect(JSON.stringify(legacyContext)).toContain("Use the Stone palette")

      yield* store.reopen(document.id)
      yield* store.update(document.id, {
        brief: { ...document.brief, objective: "UNAPPROVED REDESIGN", constraints: "Use external fonts" },
      })
      yield* Effect.promise(() => Bun.write(`${document.root}/index.html`, "UNAPPROVED REDESIGN"))
      const second = yield* store.publish(document.id, "Unapproved")
      const resumed = yield* SystemContext.initialize(yield* DesignContext.load(document.sessionID))
      const compacted = yield* SystemContext.initialize(source)
      expect(resumed).toEqual(compacted)
      expect(compacted.baseline).toContain(first.id)
      expect(compacted.baseline).toContain("Use the Stone palette")
      expect(compacted.baseline).not.toContain("UNAPPROVED REDESIGN")
      expect(yield* store.readApproval({ id: document.id, file: "index.html" })).toContain("Approved Stone")
      expect(yield* store.readApproval({ id: document.id, section: "feedback" })).toContain("Choose Stone")
      expect(yield* store.readApproval({ id: document.id, file: "../../secret" }).pipe(Effect.result)).toMatchObject({
        _tag: "Failure",
      })
      yield* store.approve(document.id, second.id)
      const updated = yield* SystemContext.reconcile(source, initial.snapshot)
      expect(updated).toMatchObject({ _tag: "Updated" })
      expect(JSON.stringify(updated)).toContain("UNAPPROVED REDESIGN")
      expect(JSON.stringify(updated)).toContain(second.id)
      expect((yield* store.approval(document.id, first.id)).variant).toEqual(variant)
    }),
  )

  it.effect("approval retries cannot change the selected direction and legacy packages remain untouched", () =>
    Effect.gen(function* () {
      const { store, document } = yield* setup
      const revision = yield* store.publish(document.id, "First")
      const variant = { id: "stone", name: "Stone" }
      yield* store.approve(document.id, revision.id, variant)
      const file = `${document.root}/../approvals/${revision.id}.json`
      const bytes = yield* Effect.promise(() => Bun.file(file).text())
      yield* store.approve(document.id, revision.id, variant)
      expect(
        yield* store.approve(document.id, revision.id, { id: "graphite", name: "Graphite" }).pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure" })
      expect(yield* Effect.promise(() => Bun.file(file).text())).toBe(bytes)
      const legacy = JSON.parse(bytes)
      delete legacy.version
      delete legacy.variant
      delete legacy.approvedAt
      yield* Effect.promise(() => Bun.write(file, JSON.stringify(legacy)))
      expect(yield* store.approval(document.id)).toMatchObject({ version: 0, variant: null, approvedAt: null })
      expect(yield* Effect.promise(() => Bun.file(file).text())).toBe(JSON.stringify(legacy))
      yield* Effect.promise(() => Bun.write(file, "broken approval"))
      expect(yield* store.approval(document.id).pipe(Effect.result)).toMatchObject({ _tag: "Failure" })
    }),
  )
  it.live(
    "audits exercised states and compares a frozen built implementation with the approved design",
    () =>
      Effect.gen(function* () {
        const { store, document } = yield* setup
        const renderer = yield* DesignRenderer.Service
        const original =
          '<!doctype html><html lang="en"><head><title>Design</title><style>button{font-size:20px}</style></head><body><main><h1>Cart</h1><button id="cart" data-state="empty" onclick="this.dataset.state=\'populated\';this.textContent=\'Added\'">Add item</button></main></body></html>'
        yield* Effect.promise(() => Bun.write(path.join(document.root, document.entry), original))
        yield* store.update(document.id, {
          scenarios: [
            {
              id: "cart",
              name: "Cart populated",
              selector: "#cart",
              state: "populated",
              actions: [{ action: "click", selector: "#cart" }],
            },
          ],
        })
        const revision = yield* store.publish(document.id, "Approved cart")
        yield* Effect.promise(() =>
          Bun.write(
            path.join(document.application, "dist/index.html"),
            original.replace("font-size:20px", "font-size:30px"),
          ),
        )
        for (const format of ["audit", "compare"] as const) {
          const job = yield* renderer.start(document.id, { revision: revision.id, format, implementation: "dist" })
          const result = yield* Effect.gen(function* () {
            for (;;) {
              const result = (yield* renderer.jobs(document.id)).find((item) => item.id === job.id)!
              if (result.status !== "running" && result.status !== "queued") return result
              yield* Effect.sleep("50 millis")
            }
          }).pipe(Effect.timeout("60 seconds"))
          expect(result.error).toBeNull()
          expect(result.status).toBe("completed")
          const report = yield* Effect.promise(() => Bun.file(result.result!).text())
          expect(report).toContain("Cart populated")
          expect(report).toContain("390px")
          expect(report).toContain("1440px")
          expect(report).toContain("data:image/png;base64,")
          if (format === "compare") {
            expect(report).toContain("pixels changed")
            expect(result.input.candidate).toBeDefined()
          }
          if (format === "audit") {
            expect(report).toContain("Cart populated: exercised")
            expect(result.audit?.scenarios).toHaveLength(3)
            const approved = yield* store.approve(document.id, revision.id)
            const frozen = yield* Effect.promise(() => Bun.file(approved.plan).text())
            expect(frozen).toContain("1 recorded audits")
            yield* store.putJob({
              ...result,
              id: "later-audit",
              audit: { ...result.audit!, findings: ["Later finding"] },
            })
            yield* store.approve(document.id, revision.id)
            expect(yield* Effect.promise(() => Bun.file(approved.plan).text())).toBe(frozen)
          }
        }
        expect((yield* store.get(document.id)).approvedRevision).toBe(revision.id)
      }),
    120000,
  )
  it.live(
    "quality audits isolate variants, inspect initial and exercised states, and recheck corrected revisions",
    () =>
      Effect.gen(function* () {
        const { store, document } = yield* setup
        const renderer = yield* DesignRenderer.Service
        const original = `<!doctype html><html lang="en"><head><title>Checkout</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:24px;color:#17202a;background:#fff}button{padding:12px;color:#17202a;background:#fff}#heading-a{background:linear-gradient(red,blue);background-clip:text;color:transparent}</style></head><body><main id="variant-a" data-design-variant="a" data-state="empty"><h1 id="heading-a">Pay invoice</h1><button id="pay-a" data-state="empty" onclick="this.parentElement.dataset.state='populated';this.style.width='2000px';this.textContent='Payment received'">Pay invoice</button></main><main data-design-variant="b"><h1>Review invoice</h1><img src="missing.png" alt="Invoice preview" width="240" height="120"><button>Download invoice</button></main></body></html>`
        yield* Effect.promise(() => Bun.write(path.join(document.root, document.entry), original))
        yield* store.update(document.id, {
          scenarios: [
            {
              id: "pay",
              variant: "a",
              name: "Pay invoice",
              selector: "#variant-a",
              state: "populated",
              actions: [{ action: "click", selector: "#pay-a" }],
            },
          ],
        })
        const before = yield* store.publish(document.id, "Before quality review")
        const audit = (revision: string) =>
          Effect.gen(function* () {
            const job = yield* renderer.start(document.id, { revision, format: "audit" })
            for (;;) {
              const current = (yield* renderer.jobs(document.id)).find((item) => item.id === job.id)!
              if (current.status === "completed" || current.status === "failed" || current.status === "interrupted")
                return current
              yield* Effect.sleep("50 millis")
            }
          }).pipe(Effect.timeout("90 seconds"))
        const first = yield* audit(before.id)
        expect(first.error).toBeNull()
        expect(first.status).toBe("completed")
        expect(first.audit?.captures).toHaveLength(9)
        expect(first.audit?.scenarios).toHaveLength(3)
        expect(
          first.audit?.checks?.some(
            (check) => check.rule === "gradient-heading" && check.variant === "a" && !check.scenario,
          ),
        ).toBe(true)
        expect(first.audit?.checks?.some((check) => check.rule === "broken-image" && check.variant === "b")).toBe(true)
        expect(first.audit?.checks?.some((check) => check.rule === "broken-image" && check.variant === "a")).toBe(false)
        expect(first.audit?.findings.some((finding) => finding.includes("a · pay: horizontal overflow"))).toBe(true)
        const message = DesignQuality.report([first], before.id)
        expect(message).toContain("gradient-heading")
        expect(message).toContain("Fix:")
        expect(message).toContain(first.audit!.captures![0].file)
        expect(message).toContain("two correction cycles")
        const corrected = original
          .replace("#heading-a{background:linear-gradient(red,blue);background-clip:text;color:transparent}", "")
          .replace("this.style.width='2000px';", "")
          .replace(
            '<img src="missing.png" alt="Invoice preview" width="240" height="120">',
            "<p>Invoice preview will appear here.</p>",
          )
        yield* Effect.promise(() => Bun.write(path.join(document.root, document.entry), corrected))
        const after = yield* store.publish(document.id, "After quality review")
        expect(DesignQuality.report([first], after.id)).toContain("No completed audit for current revision")
        expect(DesignQuality.report([first], after.id)).not.toContain("Current audit:")
        const second = yield* audit(after.id)
        expect(second.status).toBe("completed")
        expect(second.audit?.checks?.some((check) => ["broken-image", "gradient-heading"].includes(check.rule))).toBe(
          false,
        )
        expect(second.audit?.findings.some((finding) => finding.includes("horizontal overflow"))).toBe(false)
        expect(second.audit?.captures).toHaveLength(9)
        expect(DesignQuality.report([first, second], after.id)).toContain(`Previous audit ${first.id}`)
        expect((yield* store.get(document.id)).approvedRevision).toBeNull()
        expect((yield* store.jobs(document.id)).find((job) => job.id === first.id)?.audit).toEqual(first.audit)
      }),
    180000,
  )
  it.live(
    "cancels rendering, preserves terminal results and permits an explicit retry",
    () =>
      Effect.gen(function* () {
        const { store, document } = yield* setup
        const renderer = yield* DesignRenderer.Service
        const revision = yield* store.publish(document.id, "Cancellation")
        const job = yield* renderer.start(document.id, { revision: revision.id, format: "audit" })
        expect((yield* renderer.cancel(document.id, job.id)).status).toBe("cancelled")
        expect((yield* renderer.jobs(document.id)).find((item) => item.id === job.id)?.status).toBe("cancelled")
        const retry = yield* renderer.start(document.id, { revision: revision.id, format: "html" })
        const result = yield* Effect.gen(function* () {
          for (;;) {
            const item = (yield* renderer.jobs(document.id)).find((item) => item.id === retry.id)!
            if (item.status !== "running" && item.status !== "queued") return item
            yield* Effect.sleep("50 millis")
          }
        }).pipe(Effect.timeout("30 seconds"))
        expect(result.status).toBe("completed")
        expect((yield* renderer.cancel(document.id, retry.id)).status).toBe("completed")
      }),
    60000,
  )

  it.live(
    "renders animated SVG into a decodable GIF with deterministic dimensions and frame timing",
    () =>
      Effect.gen(function* () {
        const { store, document } = yield* setup
        const renderer = yield* DesignRenderer.Service
        const source =
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><circle cy="25" r="10" fill="red"><animate attributeName="cx" values="10;90;10" dur="1s" repeatCount="indefinite"/></circle></svg>'
        const asset = yield* store.importAsset(document.id, {
          name: "motion.svg",
          mime: "image/svg+xml",
          source: "user",
          data: Buffer.from(source).toString("base64"),
        })
        const revision = yield* store.publish(document.id, "Motion")
        const job = yield* renderer.start(document.id, {
          revision: revision.id,
          format: "gif",
          asset: asset.id,
          duration: 0.3,
          fps: 20,
          size: 128,
          transparent: true,
        })
        const result = yield* Effect.gen(function* () {
          for (;;) {
            const result = (yield* renderer.jobs(document.id)).find((item) => item.id === job.id)!
            if (result.status !== "running" && result.status !== "queued") return result
            yield* Effect.sleep("50 millis")
          }
        }).pipe(Effect.timeout("60 seconds"))
        expect(result.error).toBeNull()
        expect(result.status).toBe("completed")
        const bytes = yield* Effect.promise(() => Bun.file(result.result!).arrayBuffer())
        const gif = parseGIF(bytes)
        const frames = decompressFrames(gif, true)
        expect(gif.lsd.width).toBe(128)
        expect(gif.lsd.height).toBe(64)
        expect(frames).toHaveLength(6)
        expect(frames.map((frame) => frame.delay)).toEqual([50, 50, 50, 50, 50, 50])
        expect(frames[0].patch).not.toEqual(frames[5].patch)
        expect(Buffer.from(yield* store.readBlob(asset.hash)).toString()).toBe(source)
      }),
    90000,
  )

  for (const engine of ["react", "solid"] as const)
    it.live(
      `publishes a frozen ${engine} component and exercises it in Chromium`,
      () =>
        Effect.gen(function* () {
          const { store, document } = yield* setup
          const renderer = yield* DesignRenderer.Service
          const location = yield* Location.Service
          yield* Effect.promise(() => designDependencies(location.directory))
          const component = yield* store.create(document.sessionID, {
            name: "Existing component",
            journey: "existing",
            engine,
            kind: "screen",
          })
          const source =
            engine === "react"
              ? 'import { createRoot } from "react-dom/client"; import { useState } from "react"; function App(){const [count,setCount]=useState(0);return <button onClick={()=>setCount(count+1)}>Count {count}</button>} createRoot(document.getElementById("root")!).render(<App />)'
              : 'import { render } from "solid-js/web"; import { createSignal } from "solid-js"; function App(){const [count,setCount]=createSignal(0);return <button onClick={()=>setCount(count()+1)}>Count {count()}</button>} render(()=><App />,document.getElementById("root")!)'
          yield* Effect.promise(() => Bun.write(path.join(location.directory, "src/Existing.tsx"), source))
          yield* Effect.promise(() =>
            Bun.write(
              path.join(location.directory, "tsconfig.json"),
              '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
            ),
          )
          yield* Effect.promise(() => Bun.write(path.join(component.root, component.entry), 'import "@/Existing"'))
          const revision = yield* store.publish(component.id, "Component", async () => {})
          expect(revision.files[".compiled/index.html"]).toBeDefined()
          yield* Effect.promise(() => Bun.write(path.join(component.root, component.entry), "broken"))
          yield* Effect.promise(() => Bun.write(path.join(location.directory, "src/Existing.tsx"), "also broken"))
          const directory = yield* renderer.directory(revision)
          const html = yield* Effect.promise(() => DesignExport.html(directory, "index.html"))
          const browser = yield* Effect.acquireRelease(
            Effect.promise(() => chromium.launch()),
            (browser) => Effect.promise(() => browser.close()),
          )
          const page = yield* Effect.promise(() => browser.newPage())
          yield* Effect.promise(() => page.setContent(html))
          yield* Effect.promise(() => page.getByRole("button", { name: "Count 0" }).click())
          expect(yield* Effect.promise(() => page.getByRole("button", { name: "Count 1" }).textContent())).toBe(
            "Count 1",
          )
        }),
      60000,
    )
  it.effect("restores an immutable alternative as a new revision and preserves manual plan content", () =>
    Effect.gen(function* () {
      const { store, document } = yield* setup
      const file = path.join(document.root, "index.html")
      yield* Effect.promise(() => Bun.write(file, "<h1>First</h1>"))
      const first = yield* store.publish(document.id, "First")
      const attachment = yield* store.importAsset(document.id, {
        name: "reference.svg",
        mime: "image/svg+xml",
        source: "user",
        data: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
        ).toString("base64"),
      })
      const feedback = {
        id: SessionMessage.ID.create(),
        revision: first.id,
        text: "Approved spacing",
        items: [],
        assets: [attachment.id],
        snapshot: "",
        delivery: "steer" as const,
        end: false,
      }
      yield* store.prepareFeedback(document.id, feedback)
      yield* store.acknowledge(document.id, feedback)
      const approval = yield* store.approve(document.id, first.id)
      const packageFile = path.join(document.root, "../approvals", `${first.id}.json`)
      const packageBytes = yield* Effect.promise(() => Bun.file(packageFile).text())
      const frozen = JSON.parse(packageBytes)
      expect(frozen.revision.id).toBe(first.id)
      expect(frozen.feedback[0].text).toBe("Approved spacing")
      expect(frozen.assets.map((asset: { id: string }) => asset.id)).toContain(attachment.id)
      yield* store.approve(document.id, first.id)
      expect(yield* Effect.promise(() => Bun.file(packageFile).text())).toBe(packageBytes)
      yield* Effect.promise(() =>
        Bun.write(
          approval.plan,
          "Manual requirements\n" + "<!-- redcode:design:start -->old<!-- redcode:design:end -->\nManual tasks",
        ),
      )
      yield* store.reopen(document.id)
      yield* Effect.promise(() => Bun.write(file, "<h1>Second</h1>"))
      const second = yield* store.publish(document.id, "Second")
      expect(Buffer.from(yield* store.readBlob(first.files["index.html"])).toString()).toBe("<h1>First</h1>")
      const restored = yield* store.restore(document.id, first.id)
      expect(restored.id).not.toBe(first.id)
      expect(restored.parent).toBe(second.id)
      expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("<h1>First</h1>")
      expect((yield* store.get(document.id)).approvedRevision).toBe(first.id)
      yield* store.approve(document.id, restored.id)
      const plan = yield* Effect.promise(() => Bun.file(approval.plan).text())
      expect(plan).toStartWith("Manual requirements\n")
      expect(plan).toEndWith("\nManual tasks")
      expect(plan).toContain(restored.id)
      expect(plan.match(/redcode:design:start/g)).toHaveLength(1)
    }),
  )

  it.effect("freezes feedback, reconciles exact retries and rejects changed content and foreign sessions", () =>
    Effect.gen(function* () {
      const { store, document } = yield* setup
      const revision = yield* store.publish(document.id, "Review")
      const feedback = {
        id: SessionMessage.ID.create(),
        revision: revision.id,
        text: "Increase contrast",
        items: [],
        assets: [],
        snapshot: "",
        delivery: "steer" as const,
        end: true,
      }
      expect((yield* store.prepareFeedback(document.id, feedback)).admitted).toBe(false)
      expect((yield* store.prepareFeedback(document.id, feedback)).admitted).toBe(false)
      yield* store.acknowledge(document.id, feedback)
      expect((yield* store.prepareFeedback(document.id, feedback)).admitted).toBe(true)
      expect(
        (yield* store.prepareFeedback(document.id, { ...feedback, text: "Different" }).pipe(Effect.flip)).code,
      ).toBe("conflict")
      expect((yield* store.get(document.id, SessionV2.ID.make("ses_other")).pipe(Effect.flip)).code).toBe("not-found")
      expect((yield* store.publish(document.id, "Unexpected").pipe(Effect.flip)).code).toBe("conflict")
    }),
  )

  it.effect("rejects spoofed media, executable SVG and escaping paths; keeps editable SVG versions", () =>
    Effect.gen(function* () {
      const { store, document } = yield* setup
      expect(() => DesignAssets.validate(Buffer.from("fake").toString("base64"), "image/png")).toThrow()
      const truncated = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")
      expect(
        (yield* store
          .importAsset(document.id, { name: "broken.png", mime: "image/png", source: "user", data: truncated })
          .pipe(Effect.flip)).code,
      ).toBe("invalid")
      expect(() => DesignAssets.svg('<svg><image href="https://example.com/a.png"/></svg>')).toThrow()
      expect(() => DesignAssets.svg("<svg><script>alert(1)</script></svg>")).toThrow()
      expect(() => DesignFiles.relative("../outside")).toThrow()
      const input = {
        name: "loader.svg",
        mime: "image/svg+xml" as const,
        source: "user",
        data: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><circle r="4"><animate attributeName="cx" values="4;36;4" dur="1s" repeatCount="indefinite"/></circle></svg>',
        ).toString("base64"),
      }
      const original = yield* store.importAsset(document.id, input)
      const next = yield* store.importAsset(document.id, { ...input, parent: original.id })
      expect(next.parent).toBe(original.id)
      expect(next.hash).toBe(original.hash)
      expect(Buffer.from(yield* store.readBlob(original.hash)).toString("base64")).toBe(input.data)
    }),
  )
})
