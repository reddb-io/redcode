// Local demo: real storage, published Design revision, Creator API and built app. No model calls.
import path from "node:path"
import os from "node:os"
import { mkdir } from "node:fs/promises"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { base64Encode } from "@opencode/util/encode"
import { ServerFetch } from "../../server/src/fetch"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { CreatorComponents } from "../src/creator/component"
import { Database } from "../src/database/database"
import { DesignStore } from "../src/design/store"
import { Location } from "../src/location"
import { Config } from "../src/config"
import { ModelsDev } from "../src/models-dev"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { AbsolutePath } from "../src/schema"

const output = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "redcode-cube-studio"))
const directory = AbsolutePath.make(path.join(output, "project"))
await mkdir(directory, { recursive: true })
const location = { directory, project: { id: Project.ID.global, directory, canonical: directory } }
const global = Global.layerWith(
  Object.fromEntries(
    ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((key) => [
      key,
      path.join(output, "runtime", key),
    ]),
  ),
)
const replacements = [
  Location.node.replace(Layer.succeed(Location.Service, location)),
  Database.node.replace(Database.configured({ path: path.join(output, "demo.sqlite") })),
  Config.node.replace(Config.configured({ global: false, project: false })),
  ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
  Global.node.replace(global),
]
const layer = AppNodeBuilder.build(
  LayerNode.group([CreatorComponents.node, DesignStore.node, Database.node]),
  replacements,
)

await Effect.gen(function* () {
  const database = yield* Database.Service
  const designs = yield* DesignStore.Service
  const components = yield* CreatorComponents.Service
  const sessionID = Session.ID.make("ses_creator_cube_studio")
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      directory,
      slug: "cube-studio",
      title: "Cube studio · Creator",
      agent: "creator",
      version: "0.87.24",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  const documents = yield* designs.list(sessionID)
  const design =
    documents[0] ??
    (yield* designs.create(sessionID, {
      name: "Cube studio",
      journey: "new",
      engine: "html",
      kind: "screen",
      designSystem: "reddb-io/design-system · React Base Kit · application · compact",
    }))
  const compiled = yield* Effect.promise(() => Bun.file(path.join(output, "build", "component.html")).text())
  const previous = yield* Effect.promise(() =>
    Bun.file(path.join(design.root, design.entry))
      .text()
      .catch(() => ""),
  )
  if (!design.revision || previous !== compiled) {
    yield* Effect.promise(() => Bun.write(path.join(design.root, design.entry), compiled))
    yield* designs.publish(sessionID, design.id, "Cube studio · DS controls + WebGL")
  }
  const published = yield* designs.get(sessionID, design.id)
  const handler = yield* ServerFetch.make(
    {
      app: { name: "Redcode", version: "0.87.24" },
      database: { path: path.join(output, "demo.sqlite") },
      config: { global: false, project: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    },
    {
      overrides: [
        ...replacements,
        Database.node.replace(Layer.succeed(Database.Service, database)),
        DesignStore.node.replace(Layer.succeed(DesignStore.Service, designs)),
        CreatorComponents.node.replace(Layer.succeed(CreatorComponents.Service, components)),
      ],
    },
  )
  const dist = path.resolve(import.meta.dir, "../../app/dist")
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: Number(process.argv[3] ?? 3199),
        idleTimeout: 120,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/demo/setup") {
            const origin = url.origin
            const storage = {
              "opencode.global.dat:server": {
                list: [{ type: "http", displayName: "Creator demo", http: { url: origin } }],
                projects: {
                  local: [{ worktree: directory, expanded: true }],
                  [origin]: [{ worktree: directory, expanded: true }],
                },
                lastProject: { local: directory, [origin]: directory },
              },
              "opencode.window.browser.dat:tabs": [{ type: "session", server: origin, sessionId: sessionID }],
              "opencode.global.dat:language": { locale: "en" },
              "opencode-theme-id": "opencode",
              "opencode-color-scheme": "dark",
            }
            return new Response(
              `<script>for(const [key,value] of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(key,typeof value==='string'?value:JSON.stringify(value));location.href=${JSON.stringify(`/server/${base64Encode(origin)}/session/${sessionID}`)}</script>`,
              { headers: { "content-type": "text/html" } },
            )
          }
          if (url.pathname.startsWith("/api/") || url.pathname === "/global/event") return handler(request)
          const filename = path.resolve(dist, "." + decodeURIComponent(url.pathname))
          if (filename !== dist && !filename.startsWith(dist + path.sep))
            return new Response("Not found", { status: 404 })
          const file = Bun.file(filename)
          if (await file.exists()) return new Response(file)
          return new Response(Bun.file(path.join(dist, "index.html")), {
            headers: { "content-type": "text/html", "cache-control": "no-store" },
          })
        },
      }),
    ),
    (server) => Effect.promise(() => Promise.resolve(server.stop(true))),
  )
  yield* Effect.promise(() =>
    Bun.write(
      path.join(output, "demo.json"),
      JSON.stringify(
        {
          url: `${server.url.origin}/demo/setup`,
          directory,
          sessionID,
          designID: design.id,
          revision: published.revision,
          database: path.join(output, "demo.sqlite"),
        },
        null,
        2,
      ),
    ),
  )
  yield* Effect.logInfo(`Creator demo ready: ${server.url.origin}/demo/setup`)
  yield* Effect.never
}).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise)
