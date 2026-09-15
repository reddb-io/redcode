import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir, realpath, symlink } from "node:fs/promises"
import { Effect, Layer, Schema } from "effect"
import { Config } from "../src/config"
import { ConfigDesign } from "../src/config/design"
import { ConfigV1 } from "../src/v1/config/config"
import { ConfigMigrateV1 } from "../src/v1/config/migrate"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { DesignBuild } from "../src/design/build"
import { DesignStore } from "../src/design/store"
import { Location } from "../src/location"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionV2 } from "../src/session"
import { tempLocationLayer } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

let entries: Config.Entry[] = []
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed(entries) }))
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([DesignStore.node, Database.node, Location.node]), [
    [Location.node, tempLocationLayer],
    [Config.node, config],
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
      slug: "design-config",
      directory: location.directory,
      title: "design-config",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return { location, store, sessionID }
})
const document = (info: unknown) =>
  new Config.Document({ type: "document", path: "redcode.json", info: Schema.decodeUnknownSync(Config.Info)(info) })

test("the design section decodes in current configuration and survives the v1 migration", () => {
  const system = {
    paths: ["src/components", "src/tokens"],
    css: ["src/styles/globals.css"],
    tailwind: true,
    framework: "react" as const,
    aliases: { "@ui": "src/ui" },
  }
  expect(Schema.decodeUnknownSync(Config.Info)({ design: { system } }).design?.system).toEqual(system)
  expect(Schema.decodeUnknownSync(Config.Info)({ design: { system: { paths: ["src/components"] } } }).design).toEqual({
    system: { paths: ["src/components"] },
  })
  expect(() => Schema.decodeUnknownSync(Config.Info)({ design: { system: { paths: "src/components" } } })).toThrow()
  expect(() => Schema.decodeUnknownSync(Config.Info)({ design: { system: { paths: [], framework: "vue" } } })).toThrow()
  const legacy = Schema.decodeUnknownSync(ConfigV1.Info)({ permission: { read: "allow" }, design: { system } })
  expect(ConfigMigrateV1.migrate(legacy).design?.system).toEqual(system)
})

test("the effective design system completes configuration from package.json and tailwind.config", async () => {
  await using tmp = await tmpdir()
  const application = tmp.path
  await Bun.write(
    path.join(application, "package.json"),
    JSON.stringify({ dependencies: { react: "*" }, devDependencies: { tailwindcss: "*" } }),
  )
  const configured = new ConfigDesign.System({ paths: ["./src/components/"], css: ["src/styles/globals.css"] })
  expect(await DesignBuild.system(application, undefined)).toBeUndefined()
  expect(await DesignBuild.system(application, configured)).toEqual({
    paths: ["src/components"],
    css: ["src/styles/globals.css"],
    tailwind: false,
    framework: "react",
  })
  await Bun.write(path.join(application, "tailwind.config.js"), "module.exports = {}")
  expect(await DesignBuild.system(application, configured)).toEqual({
    paths: ["src/components"],
    css: ["src/styles/globals.css"],
    tailwind: true,
    framework: "react",
  })
  expect(
    await DesignBuild.system(
      application,
      new ConfigDesign.System({ paths: ["src"], tailwind: false, framework: "solid", aliases: { "@ui": "src/ui" } }),
    ),
  ).toEqual({ paths: ["src"], css: [], tailwind: false, framework: "solid", aliases: { "@ui": "src/ui" } })
  await Bun.write(path.join(application, "package.json"), JSON.stringify({ dependencies: { "solid-js": "*" } }))
  expect(await DesignBuild.system(application, new ConfigDesign.System({ paths: [] }))).toEqual({
    paths: [],
    css: [],
    tailwind: false,
    framework: "solid",
  })
  await Bun.write(path.join(application, "package.json"), "not json")
  expect(await DesignBuild.system(application, new ConfigDesign.System({ paths: [] }))).toEqual({
    paths: [],
    css: [],
    tailwind: false,
  })
})

it.live("records the effective design system on create and refresh", () =>
  Effect.gen(function* () {
    const { location, store, sessionID } = yield* setup
    entries = []
    const plain = yield* store.create(sessionID, { name: "Plain", journey: "new", engine: "react", kind: "screen" })
    expect(plain.system).toBeUndefined()
    entries = [
      document({ design: { system: { paths: ["src/components"] } } }),
      document({ design: { system: { paths: ["./src/design-system"], css: ["src/styles/globals.css"] } } }),
    ]
    yield* Effect.promise(() =>
      Bun.write(
        path.join(location.directory, "package.json"),
        JSON.stringify({ dependencies: { react: "*", tailwindcss: "*" } }),
      ),
    )
    const created = yield* store.create(sessionID, {
      name: "Configured",
      journey: "existing",
      engine: "react",
      kind: "screen",
    })
    expect(created.system).toEqual({
      paths: ["src/design-system"],
      css: ["src/styles/globals.css"],
      tailwind: false,
      framework: "react",
    })
    yield* Effect.promise(() => Bun.write(path.join(location.directory, "tailwind.config.js"), "module.exports = {}"))
    expect((yield* store.refresh(created.id)).system).toEqual({
      paths: ["src/design-system"],
      css: ["src/styles/globals.css"],
      tailwind: true,
      framework: "react",
    })
    expect((yield* store.get(created.id)).system?.tailwind).toBe(true)
    entries = []
  }),
)

it.live("design merges per key, an adopted system applies, and never to a differently named application", () =>
  Effect.gen(function* () {
    const { location, store, sessionID } = yield* setup
    yield* Effect.promise(async () => {
      await mkdir(path.join(location.directory, "apps/web/src/components"), { recursive: true })
      await mkdir(path.join(location.directory, "apps/admin"), { recursive: true })
    })
    entries = [document({ design: { browser: "chromium" } })]
    expect(yield* store.configured()).toEqual({ browser: "chromium" })
    yield* store.adopt(sessionID, {
      system: new ConfigDesign.System({ paths: ["src/components"] }),
      application: "apps/web",
    })
    expect(yield* store.configured(sessionID)).toEqual({
      browser: "chromium",
      system: { paths: ["src/components"] },
      application: "apps/web",
    })
    const web = yield* store.create(sessionID, { name: "Web", journey: "new", engine: "html", kind: "screen" })
    expect(DesignStore.applicationOf(web)).toBe("apps/web")
    expect(web.system?.paths).toEqual(["src/components"])
    const admin = yield* store.create(sessionID, {
      name: "Admin",
      journey: "new",
      engine: "html",
      kind: "screen",
      application: "apps/admin",
    })
    expect(DesignStore.applicationOf(admin)).toBe("apps/admin")
    expect(admin.system).toBeUndefined()
    expect((yield* store.refresh(admin.id)).system).toBeUndefined()
    expect((yield* store.refresh(web.id)).system?.paths).toEqual(["src/components"])
    // A system configured in a document wins over the adopted one.
    entries = [document({ design: { system: { paths: ["src/ui"] } } })]
    expect((yield* store.configured())?.system?.paths).toEqual(["src/ui"])
    yield* store.adopt(sessionID, undefined)
    entries = []
    expect(yield* store.configured(sessionID)).toBeUndefined()
  }),
)

it.live("a pending adoption belongs to its session; only a committed one applies to every session", () =>
  Effect.gen(function* () {
    const first = yield* setup
    const second = yield* setup
    const store = first.store
    entries = []
    const system = { system: new ConfigDesign.System({ paths: ["src/components"] }) }
    yield* store.adopt(first.sessionID, system)
    // Another session's failure forgets only its own adoption.
    yield* store.adopt(second.sessionID, undefined)
    expect((yield* store.configured(first.sessionID))?.system?.paths).toEqual(["src/components"])
    expect(yield* store.configured(second.sessionID)).toBeUndefined()
    expect(yield* store.configured()).toBeUndefined()
    // Once committed (written and verified), every session sees it, and a later failure elsewhere keeps it.
    yield* store.adopt(first.sessionID, system, true)
    yield* store.adopt(second.sessionID, undefined)
    expect((yield* store.configured(second.sessionID))?.system?.paths).toEqual(["src/components"])
    expect((yield* store.configured())?.system?.paths).toEqual(["src/components"])
    expect(
      yield* store.create(second.sessionID, { name: "Shared", journey: "new", engine: "html", kind: "screen" }),
    ).toMatchObject({ system: { paths: ["src/components"] } })
  }),
)

it.live("the standing grant covers declared roots, stylesheets, tooling and node_modules but never escapes", () =>
  Effect.gen(function* () {
    const { location, store, sessionID } = yield* setup
    const application = location.directory
    const outside = yield* Effect.promise(() => tmpdir())
    yield* Effect.addFinalizer(() => Effect.promise(() => outside[Symbol.asyncDispose]()))
    yield* Effect.promise(async () => {
      await mkdir(path.join(application, "src/components"), { recursive: true })
      await mkdir(path.join(application, "node_modules"), { recursive: true })
      await Bun.write(path.join(application, "src/styles/globals.css"), "body{}")
      await Bun.write(path.join(application, "tsconfig.json"), "{}")
      await Bun.write(path.join(application, "postcss.config.cjs"), "module.exports = {}")
      await Bun.write(path.join(outside.path, ".env.escape"), "ONLY_TEST_DATA")
      await symlink(outside.path, path.join(application, "src/escape"), "dir")
    })
    const created = yield* store.create(sessionID, {
      name: "Grant",
      journey: "existing",
      engine: "react",
      kind: "screen",
    })
    expect(yield* Effect.promise(() => DesignBuild.grant(created))).toEqual([])
    const grant = yield* Effect.promise(() =>
      DesignBuild.grant({
        ...created,
        system: {
          paths: ["src/components", "src/escape", "src/missing"],
          css: ["src/styles/globals.css", "../outside.css"],
          tailwind: true,
        },
      }),
    )
    const canonical = yield* Effect.promise(() => realpath(application))
    expect(grant).toEqual(
      ["node_modules", "postcss.config.cjs", "src/components", "src/styles/globals.css", "tsconfig.json"]
        .map((file) => path.join(canonical, file))
        .sort(),
    )
  }),
)
