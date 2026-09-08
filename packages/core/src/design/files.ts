export * as DesignFiles from "./files"

import path from "node:path"
import { createHash } from "node:crypto"
import { mkdir, readdir, realpath, rename, rm } from "node:fs/promises"
import { Design } from "@reddb-io/redcode-schema/design"

export const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")
export const relative = (file: string) => {
  if (
    !file ||
    path.isAbsolute(file) ||
    file.includes("\\") ||
    file.split("/").some((part) => part === ".." || part === ".review" || part === ".git")
  )
    throw new Design.Error({ code: "invalid", message: "Expected a relative artifact path" })
  return file
}

export async function resolve(root: string, file: string) {
  const target = await realpath(path.join(root, relative(file)))
  const base = await realpath(root)
  if (target !== base && !target.startsWith(base + path.sep))
    throw new Design.Error({ code: "invalid", message: "Artifact path leaves its design directory" })
  return target
}

export async function atomic(file: string, bytes: Uint8Array | string) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  try {
    await Bun.write(temporary, bytes)
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

/** Review filenames are opaque local identifiers, never paths supplied by a client. */
export async function review(storage: string, design: string, id: string, index: number, scene: string) {
  if (!/^msg_[A-Za-z0-9_-]{1,128}$/.test(id) || !/^design_[A-Za-z0-9_-]+$/.test(design))
    throw new Design.Error({ code: "invalid", message: "Invalid review identifier" })
  await mkdir(path.join(storage, design, "reviews"), { recursive: true })
  const directory = await resolve(storage, `${design}/reviews`)
  await atomic(path.join(directory, `${id}-${index}.excalidraw`), scene)
}

export async function snapshot(root: string, blobs: string, read?: (file: string) => Promise<void>) {
  const files: Record<string, string> = {}
  const budget = { bytes: 0 }
  const walk = async (directory: string) => {
    const entries = await readdir(path.join(root, directory), { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if ([".review", ".git", "node_modules", ".cache", ".compiled"].includes(entry.name)) continue
      if (entry.isSymbolicLink())
        throw new Design.Error({ code: "invalid", message: "Design snapshots cannot contain symlinks" })
      const file = path.posix.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(file)
        continue
      }
      if (!entry.isFile()) continue
      if (Object.keys(files).length >= 2000)
        throw new Design.Error({ code: "invalid", message: "Design contains more than 2000 files" })
      const resolved = await resolve(root, file)
      await read?.(resolved)
      const source = Bun.file(resolved)
      budget.bytes += source.size
      if (source.size > 25 * 1024 * 1024 || budget.bytes > 100 * 1024 * 1024)
        throw new Design.Error({ code: "invalid", message: "Snapshot limits: 25 MB per file and 100 MB in total" })
      const bytes = await source.bytes()
      const id = hash(bytes)
      if (!(await Bun.file(path.join(blobs, id)).exists())) await atomic(path.join(blobs, id), bytes)
      files[file] = id
    }
  }
  await walk("")
  return files
}

export async function restore(root: string, blobs: string, files: Readonly<Record<string, string>>) {
  const temporary = `${root}.restore-${crypto.randomUUID()}`
  const previous = `${root}.previous-${crypto.randomUUID()}`
  await mkdir(temporary, { recursive: true })
  try {
    for (const [file, id] of Object.entries(files)) {
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Design.Error({ code: "invalid", message: "Invalid snapshot hash" })
      await atomic(path.join(temporary, relative(file)), await Bun.file(path.join(blobs, id)).bytes())
    }
    await rename(root, previous)
    try {
      await rename(temporary, root)
    } catch (error) {
      await rename(previous, root)
      throw error
    }
    await rm(previous, { recursive: true, force: true })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
