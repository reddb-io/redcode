import { expect } from "bun:test"
import path from "node:path"
import { cp, mkdir, rm, stat } from "node:fs/promises"
import { Effect } from "effect"
import type { Design } from "@reddb-io/redcode-schema/design"
import { ConfigDesign } from "../src/config/design"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { DesignStore } from "../src/design/store"
import { DesignBuild } from "../src/design/build"
import { DesignFiles } from "../src/design/files"
import { Location } from "../src/location"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionV2 } from "../src/session"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { designDependencies, storeDependencies } from "./fixture/design-dependencies"

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
      slug: "design-build",
      directory: location.directory,
      title: "design-build",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return { location, store, sessionID }
})
/** Build a document's current work directory as a revision carrying the given design system, recording read requests. */
const compile = (store: DesignStore.Interface, document: Design.Info, system: Design.System, name: string) =>
  Effect.gen(function* () {
    const files = yield* Effect.promise(() => DesignFiles.snapshot(document.root, store.blobs))
    const reads: string[] = []
    const output = yield* Effect.promise(() =>
      DesignBuild.build(
        {
          id: `rev_${name}`,
          designID: document.id,
          parent: null,
          name,
          created: Date.now(),
          files,
          document: { ...document, system },
        },
        store.blobs,
        path.join(store.storage, document.id, "builds", name),
        async (file) => {
          reads.push(file)
        },
      ),
    )
    const texts = yield* Effect.promise(async () =>
      Promise.all(
        (await Array.fromAsync(new Bun.Glob("**/*.{css,js,html}").scan({ cwd: output })))
          .sort()
          .map(async (file) => [file, await Bun.file(path.join(output, file)).text()] as const),
      ),
    )
    return {
      output,
      reads,
      css: texts
        .filter(([file]) => file.endsWith(".css"))
        .map(([, text]) => text)
        .join("\n"),
      js: texts
        .filter(([file]) => file.endsWith(".js"))
        .map(([, text]) => text)
        .join("\n"),
      html: texts
        .filter(([file]) => file.endsWith(".html"))
        .map(([, text]) => text)
        .join("\n"),
    }
  })
const react = (body: string, imports = "") =>
  `import { createRoot } from "react-dom/client"\n${imports}createRoot(document.getElementById("root")!).render(${body})\n`

it.live(
  "compiles the project's Tailwind pipeline so utilities from components and the prototype are generated",
  () =>
    Effect.gen(function* () {
      const { location, store, sessionID } = yield* setup
      yield* Effect.promise(async () => {
        await cp(path.join(import.meta.dir, "fixture/tailwind"), location.directory, { recursive: true })
        await designDependencies(location.directory, ["react", "react-dom"])
        await storeDependencies(location.directory, { tailwindcss: 3, autoprefixer: 10 })
      })
      const document = yield* store.create(sessionID, {
        name: "Tailwind",
        journey: "existing",
        engine: "react",
        kind: "screen",
      })
      const system = yield* Effect.promise(() =>
        DesignBuild.system(
          document.application,
          new ConfigDesign.System({ paths: ["src/components"], css: ["src/styles/globals.css"] }),
        ),
      )
      expect(system).toEqual({
        paths: ["src/components"],
        css: ["src/styles/globals.css"],
        tailwind: true,
        framework: "react",
      })
      yield* Effect.promise(() =>
        Bun.write(
          path.join(document.root, document.entry),
          react('<main className="p-4"><Button>Buy</Button></main>', 'import { Button } from "@/components/Button"\n'),
        ),
      )
      const built = yield* compile(store, document, system!, "tailwind")
      expect(built.reads).toEqual([])
      expect(built.css).not.toContain("@tailwind")
      // A utility only the prototype uses proves its source joined the Tailwind content.
      expect(built.css).toContain(".p-4{")
      expect(built.css).toContain(".rounded-md{")
      // The theme extension comes from the project's tailwind.config.ts.
      expect(built.css).toContain(".bg-brand{")
      expect(built.css).toContain("--fixture-brand: #123456")
      expect(built.js).toContain("Fixture button")
    }),
  120000,
)

it.live(
  "forwards the project's JSX settings to prototypes that carry their own tsconfig",
  () =>
    Effect.gen(function* () {
      const { location, store, sessionID } = yield* setup
      yield* Effect.promise(async () => {
        await designDependencies(location.directory, ["react", "react-dom"])
        await Bun.write(
          path.join(location.directory, "tsconfig.json"),
          JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "design-jsx" } }),
        )
        const runtime = path.join(location.directory, "node_modules/design-jsx")
        await Bun.write(
          path.join(runtime, "package.json"),
          JSON.stringify({
            name: "design-jsx",
            type: "module",
            exports: { "./jsx-runtime": "./jsx-runtime.js", "./jsx-dev-runtime": "./jsx-dev-runtime.js" },
          }),
        )
        await Bun.write(
          path.join(runtime, "jsx-runtime.js"),
          'import { jsx as base, jsxs as bases, Fragment } from "react/jsx-runtime"\nexport { Fragment }\nexport const jsx = (type, props, key) => base(type, { ...props, "data-design-jsx": "forwarded-runtime" }, key)\nexport const jsxs = (type, props, key) => bases(type, { ...props, "data-design-jsx": "forwarded-runtime" }, key)\n',
        )
        await Bun.write(
          path.join(runtime, "jsx-dev-runtime.js"),
          'import { jsxDEV as base, Fragment } from "react/jsx-dev-runtime"\nexport { Fragment }\nexport const jsxDEV = (type, props, ...rest) => base(type, { ...props, "data-design-jsx": "forwarded-runtime" }, ...rest)\n',
        )
      })
      const document = yield* store.create(sessionID, {
        name: "JSX",
        journey: "existing",
        engine: "react",
        kind: "screen",
      })
      yield* Effect.promise(async () => {
        await Bun.write(
          path.join(document.root, "tsconfig.json"),
          JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
        )
        await Bun.write(path.join(document.root, document.entry), react("<main>Forwarded</main>"))
      })
      const built = yield* compile(store, document, { paths: [], css: [], tailwind: false, framework: "react" }, "jsx")
      expect(built.reads).toEqual([])
      expect(built.js).toContain("forwarded-runtime")
    }),
  60000,
)

for (const engine of ["html", "react", "solid"] as const)
  it.live(
    `includes the declared stylesheets in ${engine} previews`,
    () =>
      Effect.gen(function* () {
        const { location, store, sessionID } = yield* setup
        yield* Effect.promise(async () => {
          await designDependencies(location.directory)
          await Bun.write(
            path.join(location.directory, "src/styles/globals.css"),
            "@import './tokens.css';\n.design-system-marker{color:red}\n",
          )
          await Bun.write(path.join(location.directory, "src/styles/tokens.css"), ":root{--design-token:#abcdef}\n")
        })
        const document = yield* store.create(sessionID, { name: "Styles", journey: "existing", engine, kind: "screen" })
        const built = yield* compile(
          store,
          document,
          { paths: ["src/styles"], css: ["src/styles/globals.css"], tailwind: false },
          "styles",
        )
        expect(built.reads).toEqual([])
        expect(built.css).toContain(".design-system-marker{color:red}")
        expect(built.css).toContain("--design-token:#abcdef")
        if (engine !== "html") return
        expect(built.output).toBe(path.join(store.storage, document.id, "builds", "styles", "source"))
        expect(built.html).toContain('<link rel="stylesheet" href="design-system.css"></head>')
        expect(built.html).toContain('<style id="design-tweaks">')
      }),
    60000,
  )

it.live(
  "resolves dependencies through the checkout's node_modules when the design lives in a linked worktree",
  () =>
    Effect.gen(function* () {
      const { location, store, sessionID } = yield* setup
      const git = async (...args: string[]) => {
        const proc = Bun.spawn(["git", "-C", location.directory, ...args], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
        })
        const [, error, exit] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ])
        if (exit !== 0) throw new Error(error)
      }
      const worktrees = path.join(
        path.dirname(location.directory),
        ".redcode-worktrees",
        path.basename(location.directory),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => rm(worktrees, { recursive: true, force: true })))
      yield* Effect.promise(async () => {
        await Bun.write(path.join(location.directory, ".gitignore"), "node_modules\n.red\n")
        await Bun.write(
          path.join(location.directory, "package.json"),
          JSON.stringify({ dependencies: { react: "*", "react-dom": "*", "design-tokens": "*" } }),
        )
        await git("init", "--quiet")
        await git("add", ".")
        await git(
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.test",
          "commit",
          "--quiet",
          "-m",
          "fixture",
        )
        await designDependencies(location.directory, ["react", "react-dom"])
        const tokens = path.join(location.directory, "node_modules/design-tokens")
        await mkdir(tokens, { recursive: true })
        await Bun.write(
          path.join(tokens, "package.json"),
          JSON.stringify({ name: "design-tokens", type: "module", main: "index.js" }),
        )
        await Bun.write(path.join(tokens, "index.js"), 'export const token = "worktree-token-value"\n')
      })
      const document = yield* store.create(sessionID, {
        name: "Worktree",
        journey: "existing",
        engine: "react",
        kind: "screen",
      })
      expect(document.application).not.toBe(location.directory)
      expect(
        yield* Effect.promise(() =>
          stat(path.join(document.application, "node_modules")).then(
            () => true,
            () => false,
          ),
        ),
      ).toBe(false)
      yield* Effect.promise(() =>
        Bun.write(
          path.join(document.root, document.entry),
          react("<main>{token}</main>", 'import { token } from "design-tokens"\n'),
        ),
      )
      const built = yield* compile(
        store,
        document,
        { paths: [], css: [], tailwind: false, framework: "react" },
        "worktree",
      )
      expect(built.reads).toEqual([])
      expect(built.js).toContain("worktree-token-value")
    }),
  60000,
)
