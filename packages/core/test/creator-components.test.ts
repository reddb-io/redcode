import { expect } from "bun:test"
import path from "node:path"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { Workspace } from "@opencode/schema/workspace"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Config } from "../src/config"
import { CreatorComponents } from "../src/creator/component"
import { Database } from "../src/database/database"
import { DesignStore } from "../src/design/store"
import { RevisionTable } from "../src/design/sql"
import { Intelligence } from "../src/intelligence"
import { KV } from "../src/kv"
import { Location } from "../src/location"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { AbsolutePath } from "../src/schema"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const sessionID = Session.ID.make("ses_creator_components")
const settings = Layer.mock(Intelligence.Service, {
  read: () => Effect.succeed({ enabled: false, onboarding: "completed", sessionReasoning: "single" }),
  evaluate: () => Effect.succeed(undefined),
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([CreatorComponents.node, Database.node, DesignStore.node, Location.node, KV.node]),
    [
      Location.node.replace(tempLocationLayer),
      Config.node.replace(Config.testLayer()),
      Intelligence.node.replace(settings),
    ],
  ),
)

it.live(
  "Creator installations pin revisions, preserve the last good update and survive service replacement",
  () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const location = yield* Location.Service
      const designs = yield* DesignStore.Service
      const components = yield* CreatorComponents.Service
      yield* database.db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* database.db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          directory: location.directory,
          slug: "creator",
          agent: "creator",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const design = yield* designs.create(sessionID, {
        name: "Counter",
        journey: "new",
        engine: "html",
        kind: "screen",
      })
      const entry = path.join(design.root, design.entry)
      yield* Effect.promise(() =>
        Bun.write(entry, '<main>First revision</main><script>document.body.dataset.ready="yes"</script>'),
      )
      const first = yield* designs.publish(sessionID, design.id, "First")
      const installed = yield* components.install({
        sessionID,
        designID: design.id,
        revision: first.id,
        name: "Counter",
      })
      expect(installed.version).toBe(1)
      expect(
        yield* components.install({ sessionID, designID: design.id, revision: first.id, name: "Counter" }),
      ).toEqual(installed)
      yield* Effect.promise(() => Bun.write(entry, "<main>Unpublished draft</main>"))
      const preview = yield* components.preview(installed.id)
      expect(preview.html).toContain("First revision")
      expect(preview.html).not.toContain("Unpublished draft")
      expect(preview.html).toContain("connect-src 'none'")
      expect(JSON.stringify(yield* components.list())).not.toContain("<script>")

      // This HTML publication is immutable, but cannot be made portable while its dependency is missing.
      yield* Effect.promise(() => Bun.write(entry, '<main>Broken update</main><script src="./missing.js"></script>'))
      const broken = yield* designs.publish(sessionID, design.id, "Broken")
      const rejected = yield* components
        .update(installed.id, { expectedVersion: 1, revision: broken.id })
        .pipe(Effect.flip)
      expect(rejected.message).toContain("cannot be packaged")
      expect((yield* components.get(installed.id)).revision).toBe(first.id)
      expect((yield* components.get(installed.id)).version).toBe(1)

      yield* Effect.promise(() => Bun.write(entry, "<main>Second revision</main>"))
      const second = yield* designs.publish(sessionID, design.id, "Second")
      const updated = yield* components.update(installed.id, { expectedVersion: 1, revision: second.id })
      const stale = yield* components.control(installed.id, { expectedVersion: 1, enabled: false }).pipe(Effect.flip)
      expect(stale.code).toBe("conflict")
      expect(updated.version).toBe(2)

      // A fresh service graph reads the same persisted database, rather than an in-memory component list.
      const replacements = [
        Database.node.replace(Layer.succeed(Database.Service, database)),
        Location.node.replace(Layer.succeed(Location.Service, location)),
        Config.node.replace(Config.testLayer()),
        Intelligence.node.replace(settings),
      ]
      const recovered = yield* CreatorComponents.Service.use((service) => service.get(installed.id)).pipe(
        Effect.provide(AppNodeBuilder.build(CreatorComponents.node, replacements).pipe(Layer.fresh)),
      )
      expect(recovered).toEqual(updated)
      for (const otherLocation of [
        { ...location, directory: AbsolutePath.make(path.join(location.directory, "other-project")) },
        { ...location, workspaceID: Workspace.ID.make("wrk_creator_other") },
      ]) {
        const elsewhere = yield* CreatorComponents.Service.use((service) =>
          service.install({ sessionID, designID: design.id, revision: first.id, name: "Foreign" }),
        ).pipe(
          Effect.provide(
            AppNodeBuilder.build(CreatorComponents.node, [
              ...replacements,
              Location.node.replace(Layer.succeed(Location.Service, otherLocation)),
            ]).pipe(Layer.fresh),
          ),
          Effect.flip,
        )
        expect(elsewhere).toMatchObject({ code: "not-found" })
      }

      yield* database.db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
      yield* database.db.delete(RevisionTable).where(eq(RevisionTable.id, second.id)).run().pipe(Effect.orDie)
      expect((yield* components.preview(installed.id)).html).toContain("Second revision")
      const disabled = yield* components.control(installed.id, { expectedVersion: 2, enabled: false })
      expect((yield* components.preview(installed.id).pipe(Effect.flip)).code).toBe("conflict")
      const enabled = yield* components.control(installed.id, { expectedVersion: disabled.version, enabled: true })
      yield* components.remove(installed.id, { expectedVersion: enabled.version })
      expect(yield* components.list()).toEqual([])
      expect((yield* designs.revisions(sessionID, design.id)).map((revision) => revision.id)).toContain(first.id)
      expect(yield* Effect.promise(() => Bun.file(entry).exists())).toBe(true)
    }),
  60_000,
)
