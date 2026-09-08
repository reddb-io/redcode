import { Effect } from "effect"
import { AppNodeBuilder } from "../../src/effect/app-node-builder"
import { LayerNode } from "../../src/effect/layer-node"
import { Database } from "../../src/database/database"
import { DesignStore } from "../../src/design/store"
import { DesignRenderer } from "../../src/design/renderer"
import { Location } from "../../src/location"
import { Project } from "../../src/project"
import { ProjectTable } from "../../src/project/sql"
import { SessionTable } from "../../src/session/sql"
import { SessionV2 } from "../../src/session"
import { tempLocationLayer } from "../fixture/location"

await Effect.runPromise(
  Effect.gen(function* () {
    const database = yield* Database.Service
    const location = yield* Location.Service
    const store = yield* DesignStore.Service
    const renderer = yield* DesignRenderer.Service
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
        slug: "audit-perf",
        directory: location.directory,
        title: "audit-perf",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
    const document = yield* store.create(sessionID, {
      name: "Frame latency probe",
      journey: "new",
      engine: "html",
      kind: "screen",
    })
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7"/></filter><rect width="1024" height="1024" filter="url(#n)"/></svg>'
    const asset = yield* store.importAsset(document.id, {
      name: "noise.svg",
      mime: "image/svg+xml",
      source: "local-perf-fixture",
      data: Buffer.from(source).toString("base64"),
    })
    const revision = yield* store.publish(document.id, "Probe")
    for (const size of [128, 1024, 128, 1024]) {
      const delays: number[] = []
      let last = performance.now()
      const timer = setInterval(() => {
        const now = performance.now()
        delays.push(now - last)
        last = now
      }, 10)
      const start = performance.now()
      try {
        const job = yield* renderer.start(document.id, {
          revision: revision.id,
          format: "gif",
          asset: asset.id,
          duration: 0.2,
          fps: 20,
          size,
        })
        const result = yield* Effect.gen(function* () {
          for (;;) {
            const result = (yield* renderer.jobs(document.id)).find((x) => x.id === job.id)!
            if (result.status !== "running" && result.status !== "queued") return result
            yield* Effect.sleep("20 millis")
          }
        }).pipe(Effect.timeout("45 seconds"))
        console.log(
          JSON.stringify({
            size,
            status: result.status,
            error: result.error,
            elapsedMs: performance.now() - start,
            maxTickMs: Math.max(...delays),
            p95TickMs: delays.toSorted((a, b) => a - b)[Math.floor(delays.length * 0.95)],
            samples: delays.length,
            bytes: result.result ? (yield* Effect.promise(() => Bun.file(result.result!).stat())).size : null,
          }),
        )
      } finally {
        clearInterval(timer)
      }
    }
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([DesignStore.node, DesignRenderer.node, Database.node, Location.node]), [
        [Location.node, tempLocationLayer],
      ]),
    ),
  ),
)
