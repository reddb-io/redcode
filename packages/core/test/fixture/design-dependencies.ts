import path from "node:path"
import { mkdir, realpath, symlink } from "node:fs/promises"
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
