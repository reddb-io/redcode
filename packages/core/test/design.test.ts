import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { symlink } from "node:fs/promises"
import { parseGIF, decompressFrames } from "gifuct-js"
import { chromium } from "playwright-core"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { DesignStore } from "../src/design/store"
import { DesignFiles } from "../src/design/files"
import { DesignAssets } from "../src/design/assets"
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
            expect(frozen).toContain(`Audit ${result.id}`)
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
          yield* Effect.promise(() =>
            symlink(
              path.resolve(import.meta.dir, "../node_modules"),
              path.join(location.directory, "node_modules"),
              "dir",
            ),
          )
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
