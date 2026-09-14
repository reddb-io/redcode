export * as DesignInventory from "./inventory"

import path from "node:path"
import { stat } from "node:fs/promises"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignFiles } from "./files"

const LIMIT = 200
const FILES = 400
const SKIP = /(?:^|\/)(?:node_modules|__tests__|__mocks__|__snapshots__)\//
const EXCLUDED = /\.(?:test|spec|stories|d)\.[cm]?[jt]sx?$/
const NAME = /^[A-Z][A-Za-z0-9]*$/
const INDEX = /(?:^|\/)index\.[^/]+$/
const loaders = { ".ts": "ts", ".tsx": "tsx", ".js": "jsx", ".jsx": "jsx", ".mjs": "js" } as const

/**
 * Exported PascalCase names per component root, read statically with Bun's transpiler scanner: no
 * module is evaluated. A file that does not parse contributes nothing rather than failing discovery.
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
      // Barrels re-export what the component files define; the defining file wins, so index files scan last.
      const ordered = [...files.filter((file) => !INDEX.test(file)), ...files.filter((file) => INDEX.test(file))]
      return (await Promise.all(ordered.map((file) => exports(application, root, file))))
        .flat()
        .filter((entry, index, all) => all.findIndex((other) => other.name === entry.name) === index)
    }),
  )
  return entries.flat().slice(0, LIMIT)
}

async function exports(application: string, root: string, file: string) {
  const relative = path.posix.join(root, file)
  const code = await Bun.file(await DesignFiles.resolve(application, relative)).text()
  const names = scanned(code, path.extname(file))
  if (!names) return []
  const fallback = path.basename(file, path.extname(file))
  return names
    .map((name) => (name === "default" ? fallback : name))
    .filter((name, index, all) => NAME.test(name) && all.indexOf(name) === index)
    .map((name) => {
      const props = new RegExp(`\\b(?:interface|type)\\s+(${name}Props)\\b`).exec(code)?.[1]
      return props ? { root, file: relative, name, props } : { root, file: relative, name }
    })
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
