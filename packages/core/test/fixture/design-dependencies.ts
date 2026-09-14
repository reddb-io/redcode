import path from "node:path"
import { mkdir, readdir, realpath, symlink } from "node:fs/promises"
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
 * Link packages this package does not depend on from the workspace's isolated store, where
 * each entry keeps its own dependencies beside it. `major` selects among installed versions.
 */
export async function storeDependencies(directory: string, packages: Record<string, number>) {
  const store = path.join(path.dirname(fileURLToPath(import.meta.resolve("react/package.json"))), "../../..")
  const entries = await readdir(store)
  await Promise.all(
    Object.entries(packages).map(async ([name, major]) => {
      const entry = entries
        .filter((entry) => entry.startsWith(`${name.replace("/", "+")}@${major}.`))
        .sort()
        .at(-1)
      if (!entry) throw new Error(`${name}@${major} is not installed in ${store}`)
      const target = path.join(directory, "node_modules", name)
      await mkdir(path.dirname(target), { recursive: true })
      await symlink(
        await realpath(path.join(store, entry, "node_modules", name)),
        target,
        process.platform === "win32" ? "junction" : "dir",
      )
    }),
  )
}
