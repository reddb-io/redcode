export * as DesignBuild from "./build"

import path from "node:path"
import { createRequire } from "node:module"
import { mkdir, realpath } from "node:fs/promises"
import { parse } from "jsonc-parser"
import { Schema } from "effect"
import type { Design } from "@reddb-io/redcode-schema/design"
import { DesignFiles } from "./files"
import { DesignRuntime } from "./runtime"
import type { Alias, Plugin } from "vite"

export type Read = (file: string, signal?: AbortSignal) => Promise<void>

export async function materialize(revision: Design.Revision, blobs: string, directory: string) {
  await mkdir(directory, { recursive: true })
  for (const [file, hash] of Object.entries(revision.files))
    await DesignFiles.atomic(
      path.join(directory, DesignFiles.relative(file)),
      await Bun.file(path.join(blobs, hash)).bytes(),
    )
  return directory
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
  if (revision.document.engine === "html") {
    const file = path.join(source, revision.document.entry)
    const html = await Bun.file(file).text()
    await DesignFiles.atomic(file, html + tweaks(revision.document))
    return source
  }
  const { build } = await DesignRuntime.load("vite", signal)
  const require = createRequire(path.join(revision.document.application, "package.json"))
  const plugin = await (async () => {
    if (revision.document.engine === "solid") {
      const { default: solid } = await DesignRuntime.load("vite-plugin-solid", signal)
      return solid()
    }
    const { default: react } = await DesignRuntime.load("@vitejs/plugin-react", signal)
    return react()
  })()
  const packages =
    revision.document.engine === "solid"
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
    if (!read && dependencies.some((root) => canonical.startsWith(root + path.sep))) return
    if (!read) throw new Error(`Design dependency requires read authorization: ${canonical}`)
    const pending = approved.get(canonical) ?? read(canonical, signal)
    approved.set(canonical, pending)
    await pending
    signal?.throwIfAborted()
  }
  const configuration = Bun.file(path.join(revision.document.application, "tsconfig.json"))
  if (await configuration.exists()) await authorize(configuration.name!)
  const options = (await configuration.exists())
    ? Schema.decodeUnknownSync(
        Schema.Struct({
          compilerOptions: Schema.optional(
            Schema.Struct({
              baseUrl: Schema.optional(Schema.String),
              paths: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
            }),
          ),
        }),
      )(parse(await configuration.text())).compilerOptions
    : undefined
  const projectAliases = Object.entries(options?.paths ?? {}).flatMap(([name, targets]) =>
    targets[0]
      ? [
          {
            find: name.replace(/\/\*$/, ""),
            replacement: path.resolve(
              revision.document.application,
              options?.baseUrl ?? ".",
              targets[0].replace(/\/\*$/, ""),
            ),
          },
        ]
      : [],
  )
  await DesignFiles.atomic(
    path.join(source, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${tweaks(revision.document)}</head><body><div id="root"></div><script type="module" src="/${DesignFiles.relative(revision.document.entry).split("/").map(encodeURIComponent).join("/")}"></script></body></html>`,
  )
  // Vite's CSS/asset resolvers run a separate plugin container. The alias
  // resolver is shared by those containers and Rollup's module graph.
  const resolve: Alias["customResolver"] = async function (id, importer, options) {
    const resolved = await this.resolve(id, importer, { ...options, skipSelf: true })
    if (resolved) await authorize(resolved.id)
    return resolved
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
  await build({
    root: source,
    configFile: false,
    envFile: false,
    publicDir: false,
    base: "./",
    plugins: [guard(), plugin],
    // Local project configuration must not execute or load environment files
    // implicitly while publishing a prototype.
    css: { postcss: { plugins: [] } },
    esbuild: { tsconfigRaw: {} },
    worker: { plugins: () => [guard()] },
    logLevel: "error",
    cacheDir: path.join(root, "cache"),
    resolve: {
      alias: [...alias, ...projectAliases, { find: /^/, replacement: "" }].map((alias) => ({
        ...alias,
        customResolver: resolve,
      })),
    },
    build: {
      outDir: path.join(root, "output"),
      emptyOutDir: true,
      assetsInlineLimit: 25 * 1024 * 1024,
      cssCodeSplit: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })
  return path.join(root, "output")
}

function tweaks(document: Design.Info) {
  return `<style id="design-tweaks">:root{${Object.entries(document.tweaks)
    .map(([key, value]) => `${key}:${value}`)
    .join(";")}}</style>`
}
