import { expect } from "bun:test"
import path from "node:path"
import { symlink } from "node:fs/promises"
import { Effect, Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { DesignStore } from "../src/design/store"
import { DesignFiles } from "../src/design/files"
import { Location } from "../src/location"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionV2 } from "../src/session"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { designDependencies } from "./fixture/design-dependencies"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([DesignStore.node, Database.node, Location.node]), [
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
      slug: "audit",
      directory: location.directory,
      title: "audit",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return { location, store, sessionID }
})

it.live(
  "rejects feedback identifiers that leave Design storage",
  () =>
    Effect.gen(function* () {
      const { location, store, sessionID } = yield* setup
      const document = yield* store.create(sessionID, { name: "Probe", journey: "new", engine: "html", kind: "screen" })
      const revision = yield* store.publish(document.id, "probe")
      const feedback = Schema.decodeUnknownSync(Design.Feedback)({
        id: "msg_/../../../../../audit-escaped",
        revision: revision.id,
        text: "probe",
        items: [],
        assets: [],
        snapshot: "",
        delivery: "queue",
        end: false,
        whiteboards: [{ target: "probe", scene: { audit: "only-test-data" } }],
      })
      expect((yield* store.prepareFeedback(document.id, feedback).pipe(Effect.result))._tag).toBe("Failure")
      const escaped = path.join(location.directory, ".red/audit-escaped-0.excalidraw")
      expect(yield* Effect.promise(() => Bun.file(escaped).exists())).toBe(false)
    }),
  30000,
)

it.live(
  "rejects Design dependencies without read authorization",
  () =>
    Effect.gen(function* () {
      const { location, store, sessionID } = yield* setup
      yield* Effect.promise(() => designDependencies(location.directory))
      const document = yield* store.create(sessionID, {
        name: "Probe",
        journey: "new",
        engine: "react",
        kind: "screen",
      })
      const protectedPath = path.join(location.directory, ".env.audit")
      yield* Effect.promise(() => Bun.write(protectedPath, "AUDIT_PROTECTED_CONTENT_ONLY_TEST_DATA"))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(document.root, document.entry),
          `import content from ${JSON.stringify(protectedPath + "?raw")}; document.body.textContent = content;`,
        ),
      )
      const result = yield* store.publish(document.id, "raw-import-probe").pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      expect(yield* store.revisions(document.id)).toHaveLength(0)
    }),
  60000,
)

for (const kind of ["raw", "css-import", "css-url", "asset-url", "symlink"] as const)
  it.live(
    `checks read authorization for ${kind} dependencies`,
    () =>
      Effect.gen(function* () {
        const { location, store, sessionID } = yield* setup
        yield* Effect.promise(() => designDependencies(location.directory))
        const document = yield* store.create(sessionID, {
          name: "Boundary",
          journey: "new",
          engine: "react",
          kind: "screen",
        })
        const protectedPath = path.join(location.directory, kind === "css-import" ? ".env.fixture.css" : ".env.fixture")
        yield* Effect.promise(() =>
          Bun.write(protectedPath, kind === "css-import" ? "body { color: red }" : "ONLY_TEST_DATA"),
        )
        const style = path.join(location.directory, "allowed.css")
        if (kind === "css-import")
          yield* Effect.promise(() => Bun.write(style, `@import ${JSON.stringify(protectedPath)};`))
        if (kind === "css-url")
          yield* Effect.promise(() => Bun.write(style, `body { background: url(${JSON.stringify(protectedPath)}) }`))
        if (kind === "symlink")
          yield* Effect.promise(() => symlink(protectedPath, path.join(location.directory, "safe.txt")))
        if (kind === "asset-url")
          yield* Effect.promise(() =>
            Bun.write(
              path.join(location.directory, "asset.ts"),
              'document.body.textContent = new URL("./.env.fixture", import.meta.url).href',
            ),
          )
        const source =
          kind === "css-import" || kind === "css-url"
            ? `import ${JSON.stringify(style)}`
            : kind === "asset-url"
              ? `import ${JSON.stringify(path.join(location.directory, "asset.ts"))}`
              : `import content from ${JSON.stringify((kind === "symlink" ? path.join(location.directory, "safe.txt") : protectedPath) + "?raw")}; document.body.textContent = content`
        yield* Effect.promise(() => Bun.write(path.join(document.root, document.entry), source))
        const reads: string[] = []
        const result = yield* store
          .publish(document.id, kind, async (file) => {
            reads.push(file)
            if (file === protectedPath) throw new Error("Fixture permission denied")
          })
          .pipe(Effect.result)
        expect(result._tag).toBe("Failure")
        expect(reads).toContain(protectedPath)
        expect(yield* store.revisions(document.id)).toHaveLength(0)
      }),
    60000,
  )

it.live("allows explicitly authorized product imports and captures the compiled result", () =>
  Effect.gen(function* () {
    const { location, store, sessionID } = yield* setup
    yield* Effect.promise(() => designDependencies(location.directory))
    const document = yield* store.create(sessionID, {
      name: "Allowed",
      journey: "existing",
      engine: "react",
      kind: "screen",
    })
    const component = path.join(location.directory, "component.ts")
    yield* Effect.promise(() => Bun.write(component, 'export const title = "Explicitly allowed product component"'))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(document.root, document.entry),
        `import { title } from ${JSON.stringify(component)}; document.body.textContent = title`,
      ),
    )
    const reads: string[] = []
    const revision = yield* store.publish(document.id, "Allowed", async (file) => {
      reads.push(file)
    })
    expect(reads).toContain(component)
    const compiled = Object.entries(revision.files).filter(
      ([name]) => name.startsWith(".compiled/") && name.endsWith(".js"),
    )
    const texts = yield* Effect.promise(() =>
      Promise.all(compiled.map(([, hash]) => Bun.file(path.join(store.blobs, hash)).text())),
    )
    expect(texts.some((text) => text.includes("Explicitly allowed product component"))).toBe(true)
  }),
)

for (const value of ['"./\\u002eenv.fixture"', "`./${name}.fixture`"])
  it.live("rejects asset URL forms that cannot be authorized statically: " + value, () =>
    Effect.gen(function* () {
      const { location, store, sessionID } = yield* setup
      yield* Effect.promise(() => designDependencies(location.directory))
      const document = yield* store.create(sessionID, {
        name: "Unsupported URL",
        journey: "new",
        engine: "react",
        kind: "screen",
      })
      yield* Effect.promise(() =>
        Bun.write(
          path.join(document.root, document.entry),
          `const name = "only-test-data"; document.body.textContent = new URL(${value}, import.meta.url).href`,
        ),
      )
      const result = yield* store.publish(document.id, "URL fixture", async () => {}).pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") expect(result.failure.message).toContain("plain static paths")
      expect(yield* store.revisions(document.id)).toHaveLength(0)
    }),
  )

it.live("rejects review-directory symlinks escaping Design storage", () =>
  Effect.gen(function* () {
    const { location, store, sessionID } = yield* setup
    const document = yield* store.create(sessionID, { name: "Review", journey: "new", engine: "html", kind: "screen" })
    const revision = yield* store.publish(document.id, "Review")
    yield* Effect.promise(() => symlink(location.directory, path.join(store.storage, document.id, "reviews"), "dir"))
    const feedback = Schema.decodeUnknownSync(Design.Feedback)({
      id: "msg_fixture",
      revision: revision.id,
      text: "fixture",
      items: [],
      assets: [],
      snapshot: "",
      delivery: "queue",
      end: false,
      whiteboards: [{ target: "fixture", scene: { text: "ONLY_TEST_DATA" } }],
    })
    expect((yield* store.prepareFeedback(document.id, feedback).pipe(Effect.result))._tag).toBe("Failure")
    expect(
      yield* Effect.promise(() => Bun.file(path.join(location.directory, "msg_fixture-0.excalidraw")).exists()),
    ).toBe(false)
  }),
)
