export * as DesignBuild from "./build"

import path from "node:path"
import { createRequire } from "node:module"
import { mkdir, readdir, realpath, stat } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { parse } from "jsonc-parser"
import { Option, Schema } from "effect"
import type { Design } from "@reddb-io/redcode-schema/design"
import type { ConfigDesign } from "../config/design"
import { RepositoryGuard } from "../repository-guard"
import { DesignFiles } from "./files"
import { DesignRuntime } from "./runtime"
import type { Alias, Plugin, UserConfig } from "vite"

export type Read = (file: string, signal?: AbortSignal) => Promise<void>

type Postcss = Exclude<NonNullable<NonNullable<UserConfig["css"]>["postcss"]>, string>
type PostcssPlugin = NonNullable<Postcss["plugins"]>[number]

const Manifest = Schema.Struct({
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
const Tsconfig = Schema.Struct({
  compilerOptions: Schema.optional(
    Schema.Struct({
      baseUrl: Schema.optional(Schema.String),
      paths: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
      jsx: Schema.optional(Schema.String),
      jsxFactory: Schema.optional(Schema.String),
      jsxFragmentFactory: Schema.optional(Schema.String),
      jsxImportSource: Schema.optional(Schema.String),
      experimentalDecorators: Schema.optional(Schema.Boolean),
      useDefineForClassFields: Schema.optional(Schema.Boolean),
    }),
  ),
})
const PostcssConfig = Schema.Struct({
  plugins: Schema.optional(Schema.Union([Schema.Array(Schema.Unknown), Schema.Record(Schema.String, Schema.Unknown)])),
})
const Jsx = Schema.Literals(["preserve", "react-native", "react", "react-jsx", "react-jsxdev"])
const tooling = ["package.json", "tsconfig.json", "postcss.config.*", "tailwind.config.*"]
const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  )
const posix = (file: string) => file.split(path.sep).join("/")

export async function materialize(revision: Design.Revision, blobs: string, directory: string) {
  await mkdir(directory, { recursive: true })
  for (const [file, hash] of Object.entries(revision.files))
    await DesignFiles.atomic(
      path.join(directory, DesignFiles.relative(file)),
      await Bun.file(path.join(blobs, hash)).bytes(),
    )
  return directory
}

/**
 * The checkout whose node_modules and tooling configuration resolve the application's
 * dependencies. A linked task worktree usually has no node_modules of its own.
 */
export async function home(application: string) {
  if (await exists(path.join(application, "node_modules"))) return application
  const repository = await RepositoryGuard.inspect(application).catch(() => undefined)
  if (!repository?.linked) return application
  const main = path.join(path.dirname(repository.commonDirectory), path.relative(repository.root, application))
  return (await exists(path.join(main, "node_modules"))) ? main : application
}

/** The effective design system of an application: its configuration completed with package.json and tailwind.config.* defaults. */
export async function system(
  application: string,
  configured?: ConfigDesign.System,
): Promise<Design.System | undefined> {
  if (!configured) return
  const manifest = Option.getOrElse(
    Schema.decodeUnknownOption(Manifest)(
      await Bun.file(path.join(application, "package.json"))
        .json()
        .catch(() => ({})),
    ),
    () => ({}) as typeof Manifest.Type,
  )
  const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
  const configs = await Array.fromAsync(
    new Bun.Glob("tailwind.config.*").scan({ cwd: application, onlyFiles: true, followSymlinks: false }),
  )
  const normalize = (file: string) => path.posix.normalize(file.split("\\").join("/")).replace(/^\.\/|\/$/g, "")
  const framework =
    configured.framework ??
    (dependencies.includes("solid-js") ? "solid" : dependencies.includes("react") ? "react" : undefined)
  return {
    paths: configured.paths.map(normalize),
    css: (configured.css ?? []).map(normalize),
    tailwind: configured.tailwind ?? (configs.length > 0 && dependencies.includes("tailwindcss")),
    ...(framework ? { framework } : {}),
    ...(configured.aliases ? { aliases: configured.aliases } : {}),
  }
}

/**
 * Canonical paths a preview build reads under the standing design-system grant: the declared
 * roots and stylesheets, the tooling configuration and the node_modules they resolve through.
 * Entries that do not exist or leave the application are left out.
 */
export async function grant(document: Design.Info) {
  if (!document.system) return []
  const application = document.application
  const base = await home(application)
  const declared = await Promise.all(
    [...document.system.paths, ...document.system.css].map((file) =>
      DesignFiles.resolve(application, file).catch(() => undefined),
    ),
  )
  const configuration = await Promise.all(
    [...new Set([application, base])].map(async (directory) =>
      Promise.all(
        (
          await Array.fromAsync(
            new Bun.Glob(`{${tooling.join(",")}}`).scan({ cwd: directory, onlyFiles: true, followSymlinks: false }),
          )
        ).map((file) => realpath(path.join(directory, file))),
      ),
    ),
  )
  const modules = await Promise.all(
    [...new Set([application, base])].map((directory) =>
      realpath(path.join(directory, "node_modules")).catch(() => undefined),
    ),
  )
  return [
    ...new Set(
      [...declared, ...configuration.flat(), ...modules].filter((entry): entry is string => entry !== undefined),
    ),
  ].sort()
}

/**
 * The stores installed packages resolve through: the outermost node_modules holding each
 * package's canonical files, so transitive dependencies in an isolated layout count too.
 */
async function installed(directories: string[]) {
  const packages = await Promise.all(
    directories.map(async (directory) => {
      const modules = path.join(directory, "node_modules")
      const entries = await readdir(modules, { withFileTypes: true }).catch(() => [])
      const scoped = await Promise.all(
        entries
          .filter((entry) => entry.name.startsWith("@"))
          .map((entry) =>
            readdir(path.join(modules, entry.name))
              .catch(() => [])
              .then((items) => items.map((item) => path.join(modules, entry.name, item))),
          ),
      )
      return [
        ...entries
          .filter((entry) => !entry.name.startsWith("@") && !entry.name.startsWith("."))
          .map((entry) => path.join(modules, entry.name)),
        ...scoped.flat(),
      ]
    }),
  )
  const canonical = await Promise.all(packages.flat().map((file) => realpath(file).catch(() => undefined)))
  return [
    ...new Set(
      canonical
        .filter((entry): entry is string => entry !== undefined)
        .map((entry) => {
          const parts = entry.split(path.sep)
          const index = parts.indexOf("node_modules")
          return index === -1 ? entry : parts.slice(0, index + 1).join(path.sep)
        }),
    ),
  ]
}

export async function build(
  revision: Design.Revision,
  blobs: string,
  directory: string,
  read?: Read,
  signal?: AbortSignal,
) {
  // Vite resolves module IDs through realpath, including Windows short paths and junctions.
  // Its root and our dependency boundary must use that same filesystem identity.
  const source = await realpath(await materialize(revision, blobs, path.join(directory, "source")))
  const root = path.dirname(source)
  if (revision.files[".compiled/index.html"]) return path.join(source, ".compiled")
  const document = revision.document
  const application = document.application
  const stylesheets = (document.system?.css ?? []).map((file) => path.join(application, file))
  if (document.engine === "html" && !stylesheets.length) {
    const file = path.join(source, document.entry)
    const html = await Bun.file(file).text()
    await DesignFiles.atomic(file, html + tweaks(document))
    return source
  }
  const { build } = await DesignRuntime.load("vite", signal)
  const base = await home(application)
  const require = createRequire(path.join(base, "package.json"))
  // Installed packages are usually symlinks into a store; their canonical files count as node_modules.
  const trusted = [
    ...(await grant(document)),
    ...(document.system ? await installed([...new Set([application, base])]) : []),
  ]
  const plugins = await (async () => {
    if (document.engine === "html") return []
    if (document.engine === "solid") {
      const { default: solid } = await DesignRuntime.load("vite-plugin-solid", signal)
      return [solid()]
    }
    const { default: react } = await DesignRuntime.load("@vitejs/plugin-react", signal)
    return [react()]
  })()
  const packages =
    document.engine === "html"
      ? []
      : document.engine === "solid"
        ? ["solid-js", "solid-js/web", "solid-js/store"]
        : ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"]
  const alias = packages.map((name) => ({
    find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: name.startsWith("solid-js")
      ? path.join(
          path.dirname(require.resolve("solid-js/package.json")),
          name === "solid-js" ? "dist/solid.js" : name === "solid-js/web" ? "web/dist/web.js" : "store/dist/store.js",
        )
      : require.resolve(name),
    fallbacks: [] as string[],
  }))
  const dependencies = await Promise.all(
    packages.map(async (name) =>
      realpath(
        path.dirname(
          require.resolve(
            `${name.startsWith("solid-js") ? "solid-js" : name.startsWith("react-dom") ? "react-dom" : "react"}/package.json`,
          ),
        ),
      ),
    ),
  )
  const approved = new Map<string, Promise<void>>()
  const authorize = async (id: string) => {
    signal?.throwIfAborted()
    const file = id.replace(/[?#].*$/, "")
    if (!path.isAbsolute(file)) return
    const canonical = await realpath(file)
    if (canonical.startsWith(source + path.sep)) return
    if (trusted.some((entry) => canonical === entry || canonical.startsWith(entry + path.sep))) return
    if (!read && dependencies.some((root) => canonical.startsWith(root + path.sep))) return
    if (!read) throw new Error(`Design dependency requires read authorization: ${canonical}`)
    const pending = approved.get(canonical) ?? read(canonical, signal)
    approved.set(canonical, pending)
    await pending
    signal?.throwIfAborted()
  }
  const configuration = Bun.file(path.join(application, "tsconfig.json"))
  if (await configuration.exists()) await authorize(configuration.name!)
  const options = (await configuration.exists())
    ? Schema.decodeUnknownSync(Tsconfig)(parse(await configuration.text())).compilerOptions
    : undefined
  const projectAliases = [
    ...Object.entries(options?.paths ?? {}).flatMap(([name, targets]) => {
      const resolved = targets.map((target) =>
        path.resolve(application, options?.baseUrl ?? ".", target.replace(/\/\*$/, "")),
      )
      return resolved.length
        ? [{ find: name.replace(/\/\*$/, ""), replacement: resolved[0], fallbacks: resolved.slice(1) }]
        : []
    }),
    ...Object.entries(document.system?.aliases ?? {}).map(([find, target]) => ({
      find,
      replacement: path.resolve(application, target),
      fallbacks: [] as string[],
    })),
  ]
  if (document.engine !== "html")
    await DesignFiles.atomic(
      path.join(source, "index.html"),
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${tweaks(document)}</head><body><div id="root"></div><script type="module" src="/${DesignFiles.relative(document.entry).split("/").map(encodeURIComponent).join("/")}"></script></body></html>`,
    )
  const entry = path.join(source, document.entry)
  if (document.engine !== "html" && stylesheets.length)
    await DesignFiles.atomic(
      entry,
      stylesheets.map((file) => `import ${JSON.stringify(file)};\n`).join("") + (await Bun.file(entry).text()),
    )
  // The html engine links one built stylesheet; Vite compiles it from an importer next to the page.
  const importer = path.join(source, "design-system.css")
  if (document.engine === "html")
    await DesignFiles.atomic(importer, stylesheets.map((file) => `@import ${JSON.stringify(file)};\n`).join(""))
  // Vite's CSS/asset resolvers run a separate plugin container. The alias
  // resolver is shared by those containers and Rollup's module graph. A bare
  // specifier a linked worktree cannot resolve is retried from the checkout
  // holding node_modules; tsconfig paths with several targets fall back in order.
  const resolver = (target: { replacement: string; fallbacks: string[] }): Alias["customResolver"] =>
    async function (id, importer, options) {
      const candidates: [string, string | undefined][] = [
        [id, importer],
        ...target.fallbacks.map((fallback): [string, string | undefined] => [
          fallback + id.slice(target.replacement.length),
          importer,
        ]),
        ...(base !== application && !id.startsWith(".") && !id.startsWith("\0") && !path.isAbsolute(id)
          ? [[id, path.join(base, "package.json")] as [string, string]]
          : []),
      ]
      for (const [candidate, from] of candidates) {
        const resolved = await this.resolve(candidate, from, { ...options, skipSelf: true })
        if (!resolved) continue
        await authorize(resolved.id)
        return resolved
      }
      return null
    }
  const guard = (): Plugin => ({
    name: "design-read-permissions",
    enforce: "pre",
    async load(id) {
      await authorize(id)
      if (/\.(?:less|scss|sass|styl|stylus)(?:[?#]|$)/i.test(id))
        throw new Error(
          "Design builds require compiled CSS; preprocessors can read outside the authorized import graph",
        )
      return null
    },
    async transform(code, id) {
      // Vite resolves relative new URL assets directly, bypassing its resolver.
      // Match the same literal form before its asset/worker transform reads it.
      for (const match of code.matchAll(
        /\bnew\s+URL\s*\(\s*('[^']+'|"[^"]+"|`[^`]+`)\s*,\s*import\.meta\.url\s*(?:,\s*)?\)/g,
      )) {
        const value = match[1].slice(1, -1)
        if (value.includes("\\") || value.includes("${"))
          throw new Error(
            "Design asset URLs require plain static paths; use explicit asset imports for escaped or dynamic URLs",
          )
        if (!value.startsWith(".")) continue
        await authorize(path.resolve(path.dirname(id.replace(/[?#].*$/, "")), value))
      }
      return null
    },
  })
  const postcss = document.system?.tailwind ? await pipeline(base, application, source, require, authorize) : []
  // The project's tsconfig governs JSX and class semantics; Vite fills the rest from the nearest tsconfig.
  const jsx = Option.getOrUndefined(Schema.decodeUnknownOption(Jsx)(options?.jsx))
  const compilerOptions = {
    ...(jsx ? { jsx } : {}),
    ...(options?.jsxFactory ? { jsxFactory: options.jsxFactory } : {}),
    ...(options?.jsxFragmentFactory ? { jsxFragmentFactory: options.jsxFragmentFactory } : {}),
    ...(options?.jsxImportSource ? { jsxImportSource: options.jsxImportSource } : {}),
    ...(options?.experimentalDecorators === undefined
      ? {}
      : { experimentalDecorators: options.experimentalDecorators }),
    ...(options?.useDefineForClassFields === undefined
      ? {}
      : { useDefineForClassFields: options.useDefineForClassFields }),
  }
  const output = path.join(root, document.engine === "html" ? "styles" : "output")
  await build({
    root: source,
    configFile: false,
    envFile: false,
    publicDir: false,
    base: "./",
    plugins: [guard(), ...plugins],
    // Local project configuration must not execute or load environment files
    // implicitly while publishing a prototype; the declared design system opts
    // its PostCSS pipeline in explicitly.
    css: { postcss: { plugins: postcss } },
    esbuild: { tsconfigRaw: { compilerOptions } },
    worker: { plugins: () => [guard()] },
    logLevel: "error",
    cacheDir: path.join(root, "cache"),
    resolve: {
      alias: [...alias, ...projectAliases, { find: /^/, replacement: "", fallbacks: [] }].map((alias) => ({
        find: alias.find,
        replacement: alias.replacement,
        customResolver: resolver(alias),
      })),
    },
    build: {
      outDir: output,
      emptyOutDir: true,
      assetsInlineLimit: 25 * 1024 * 1024,
      cssCodeSplit: document.engine === "html",
      rollupOptions:
        document.engine === "html"
          ? { input: importer, output: { assetFileNames: "design-system.css" } }
          : { output: { inlineDynamicImports: true } },
    },
  })
  if (document.engine !== "html") return output
  await DesignFiles.atomic(importer, await Bun.file(path.join(output, "design-system.css")).bytes())
  const html = await Bun.file(entry).text()
  const link = `<link rel="stylesheet" href="${posix(path.relative(path.dirname(entry), importer))}">`
  await DesignFiles.atomic(
    entry,
    (html.includes("</head>") ? html.replace("</head>", link + "</head>") : link + html) + tweaks(document),
  )
  return source
}

/**
 * The project's PostCSS plugins for a preview build: postcss.config.* when present, else tailwindcss
 * with autoprefixer. Tailwind content is completed with the prototype so its utilities are generated.
 */
async function pipeline(
  base: string,
  application: string,
  source: string,
  require: NodeJS.Require,
  authorize: (file: string) => Promise<void>,
) {
  const find = async (name: string) => {
    const files = await Array.fromAsync(
      new Bun.Glob(`${name}.{js,cjs,mjs,ts,mts,cts}`).scan({ cwd: base, onlyFiles: true, followSymlinks: false }),
    )
    const [first] = files.sort()
    return first ? path.join(base, first) : undefined
  }
  const load = async (file: string): Promise<unknown> => {
    await authorize(file)
    const module: unknown = await import(pathToFileURL(file).href)
    return typeof module === "object" && module && "default" in module ? module.default : module
  }
  const tailwindFile = await find("tailwind.config")
  const tailwind = tailwindFile ? await load(tailwindFile) : {}
  const content: unknown = typeof tailwind === "object" && tailwind && "content" in tailwind ? tailwind.content : []
  const declared: readonly unknown[] = Array.isArray(content)
    ? content
    : typeof content === "object" && content && "files" in content && Array.isArray(content.files)
      ? content.files
      : []
  // Tailwind resolves relative content globs from the process directory, not the project.
  const files = [
    ...declared.map((item) =>
      typeof item !== "string" || path.isAbsolute(item.replace(/^!/, ""))
        ? item
        : `${item.startsWith("!") ? "!" : ""}${posix(path.resolve(application, item.replace(/^!/, "")))}`,
    ),
    `${posix(source)}/**/*.{html,js,jsx,ts,tsx,mjs,mdx,vue,svelte}`,
  ]
  const config = {
    ...(typeof tailwind === "object" ? tailwind : {}),
    content: typeof content === "object" && content && !Array.isArray(content) ? { ...content, files } : files,
  }
  const resolvable = (name: string) => {
    try {
      require.resolve(name)
      return true
    } catch {
      return false
    }
  }
  const instantiate = (name: string, options: unknown) => {
    const loaded: unknown = require(name)
    const factory = (
      typeof loaded === "function"
        ? loaded
        : typeof loaded === "object" && loaded && "default" in loaded
          ? loaded.default
          : undefined
    ) as ((options?: unknown) => PostcssPlugin) | undefined
    if (!factory) throw new Error(`PostCSS plugin ${name} does not export a plugin factory`)
    if (name === "tailwindcss") return factory(config)
    if (name === "@tailwindcss/postcss")
      return factory({ base: application, ...(typeof options === "object" && options ? options : {}) })
    return factory(options)
  }
  const postcssFile = await find("postcss.config")
  const loaded = postcssFile ? await load(postcssFile) : undefined
  const configured = Option.getOrUndefined(
    Schema.decodeUnknownOption(PostcssConfig)(
      typeof loaded === "function"
        ? (loaded as (context: unknown) => unknown)({ env: "production", cwd: base, file: postcssFile })
        : loaded,
    ),
  )?.plugins
  const plugins =
    configured ??
    Object.fromEntries([["tailwindcss", {}], ...(resolvable("autoprefixer") ? [["autoprefixer", {}]] : [])])
  const list: readonly unknown[] | undefined = Array.isArray(plugins) ? plugins : undefined
  if (list)
    return list.map((item) =>
      typeof item === "string"
        ? instantiate(item, {})
        : typeof item === "object" && item && "postcssPlugin" in item && item.postcssPlugin === "tailwindcss"
          ? instantiate("tailwindcss", {})
          : (item as PostcssPlugin),
    )
  return Object.entries(plugins).flatMap(([name, options]) =>
    options === false ? [] : [instantiate(name, options ?? {})],
  )
}

function tweaks(document: Design.Info) {
  return `<style id="design-tweaks">:root{${Object.entries(document.tweaks)
    .map(([key, value]) => `${key}:${value}`)
    .join(";")}}</style>`
}
