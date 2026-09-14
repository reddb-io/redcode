import path from "node:path"
import { cp, mkdir, realpath, symlink } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export async function designDependencies(directory: string, packages = ["react", "react-dom", "solid-js"]) {
  // Windows CI hoists dependencies to the workspace root. Link resolved package
  // directories so fixtures also work with Bun's isolated dependency layout.
  await Promise.all(
    packages.map(async (name) => {
      const target = path.join(directory, "node_modules", name)
      await mkdir(path.dirname(target), { recursive: true })
      await symlink(
        await realpath(path.dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`)))),
        target,
        process.platform === "win32" ? "junction" : "dir",
      )
    }),
  )
}

/**
 * Copy packages and their dependency closure into a fixture's own node_modules. A design build
 * trusts only files under the node_modules directories it names, so a linked store elsewhere
 * would not do. Packages resolve from this package (isolated or hoisted layout alike) and their
 * dependencies from each copied package's original location.
 */
export async function materializeDependencies(directory: string, packages: string[]) {
  const modules = path.join(directory, "node_modules")
  const queue = packages.map((name) => ({ name, from: path.join(import.meta.dir, "package.json") }))
  const done = new Set<string>()
  while (queue.length) {
    const { name, from } = queue.shift()!
    if (done.has(name)) continue
    done.add(name)
    const source = await locate(name, from)
    if (!source) continue
    const target = path.join(modules, name)
    await mkdir(path.dirname(target), { recursive: true })
    await cp(source, target, {
      recursive: true,
      dereference: true,
      filter: (file) => !file.slice(source.length).includes(`${path.sep}node_modules${path.sep}`),
    })
    const manifest = (await Bun.file(path.join(source, "package.json")).json()) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    queue.push(
      ...Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies }).map(
        (dependency) => ({ name: dependency, from: path.join(source, "package.json") }),
      ),
    )
  }
}

/** The real directory of a package as resolved from `from`; undefined when it is not installed. */
async function locate(name: string, from: string) {
  const resolved = (() => {
    try {
      return Bun.resolveSync(`${name}/package.json`, path.dirname(from))
    } catch {
      try {
        return Bun.resolveSync(name, path.dirname(from))
      } catch {
        return undefined
      }
    }
  })()
  if (!resolved) return
  const marker = `${path.sep}node_modules${path.sep}${name.split("/").join(path.sep)}${path.sep}`
  const index = resolved.lastIndexOf(marker)
  const directory = index === -1 ? path.dirname(resolved) : resolved.slice(0, index + marker.length - 1)
  return realpath(directory)
}
