export * as DesignInventory from "./inventory"

import path from "node:path"
import { stat } from "node:fs/promises"
import { Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignFiles } from "./files"

const LIMIT = 200
const ROOT_LIMIT = 60
const FILES = 400
const BYTES = 256 * 1024
const SKIP = /(?:^|\/)(?:node_modules|__tests__|__mocks__|__snapshots__)\//
const EXCLUDED = /\.(?:test|spec|stories|d)\.[cm]?[jt]sx?$/
const NAME = /^[A-Z][A-Za-z0-9]*$/
const INDEX = /(?:^|\/)index\.[^/]+$/
const JSX = /\.[jt]sx$/
const UI = /^(?:react|react-dom|preact|solid-js|vue|svelte|lit|@angular\/core)$/
const loaders = { ".ts": "ts", ".tsx": "tsx", ".js": "jsx", ".jsx": "jsx", ".mjs": "js" } as const
const Dependencies = Schema.Record(Schema.String, Schema.String).pipe(Schema.optionalKey)
const decodePackage = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ dependencies: Dependencies, peerDependencies: Dependencies })),
)

/**
 * Exported PascalCase names per component root, read statically with Bun's transpiler scanner: no
 * module is evaluated. Files that are too large, unreadable, outside the application or unparsable
 * contribute nothing rather than failing the design.
 */
export async function scan(application: string, roots: readonly string[]): Promise<Design.Component[]> {
  const entries = await Promise.all(
    roots.map(async (root) => {
      const directory = path.join(application, root)
      if (!(await stat(directory).catch(() => undefined))?.isDirectory()) return []
      const files = (
        await Array.fromAsync(
          new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs}").scan({ cwd: directory, onlyFiles: true, followSymlinks: false }),
        )
      )
        .map((file) => file.split(path.sep).join("/"))
        .filter((file) => !SKIP.test(file) && !EXCLUDED.test(file))
        .sort()
        .slice(0, FILES)
      // A monorepo package is a component root only when it renders: JSX files or a UI framework dependency.
      if (root.startsWith("packages/") && !files.some((file) => JSX.test(file)) && !(await ui(directory))) return []
      // Barrels re-export what the component files define; the defining file wins, so index files scan last.
      const ordered = [...files.filter((file) => !INDEX.test(file)), ...files.filter((file) => INDEX.test(file))]
      return (await Promise.all(ordered.map((file) => exports(application, root, file))))
        .flat()
        .filter((entry, index, all) => all.findIndex((other) => other.name === entry.name) === index)
        .slice(0, ROOT_LIMIT)
    }),
  )
  return entries.flat().slice(0, LIMIT)
}

async function ui(directory: string) {
  const manifests = await Promise.all(
    [directory, path.dirname(directory)].map(async (candidate) => {
      const file = Bun.file(path.join(candidate, "package.json"))
      return (await file.exists()) ? decodePackage(await file.text()) : undefined
    }),
  )
  return manifests.some(
    (parsed) =>
      parsed?._tag === "Some" &&
      Object.keys({ ...parsed.value.peerDependencies, ...parsed.value.dependencies }).some((name) => UI.test(name)),
  )
}

async function exports(application: string, root: string, file: string) {
  const relative = path.posix.join(root, file)
  const code = await read(application, relative)
  const names = code === undefined ? undefined : scanned(code, path.extname(file))
  if (!names) return []
  const fallback = path.basename(file, path.extname(file))
  return names
    .map((name) => (name === "default" ? fallback : name))
    .filter((name, index, all) => NAME.test(name) && all.indexOf(name) === index)
    .map((name) => {
      const props = new RegExp(`\\b(?:interface|type)\\s+(${name}Props)\\b`).exec(code!)?.[1]
      return props ? { root, file: relative, name, props } : { root, file: relative, name }
    })
}

async function read(application: string, relative: string) {
  // resolve rejects `..` segments and paths whose real location leaves the application (symlinks).
  try {
    const file = Bun.file(await DesignFiles.resolve(application, relative))
    return file.size > BYTES ? undefined : await file.text()
  } catch {
    return undefined
  }
}

function scanned(code: string, extension: string) {
  const loader = loaders[extension as keyof typeof loaders]
  if (!loader) return undefined
  // Bun.Transpiler.scan throws an AggregateError on a syntax error; a broken file is not a component.
  try {
    return new Bun.Transpiler({ loader }).scan(code).exports
  } catch {
    return undefined
  }
}
