export * as SessionArtifacts from "./artifacts.js"

import path from "node:path"
import { mkdir, readdir, stat } from "node:fs/promises"
import { Global } from "@opencode/util/global"
import { Flock } from "@opencode/util/flock"
import { DesignFiles } from "../design/files.js"

export type Revision = {
  id: string
  created: number
  entry: string
  files: Record<string, string>
}

export type Info = {
  id: string
  sessionID: string
  title: string
  created: number
  updated: number
  revisions: Revision[]
}

export class Error extends globalThis.Error {
  constructor(
    readonly code: "invalid" | "not-found" | "conflict",
    message: string,
  ) {
    super(message)
  }
}

const safeSession = (sessionID: string) => {
  if (!/^ses_[A-Za-z0-9_-]+$/.test(sessionID)) throw new Error("invalid", "Invalid session ID")
  return sessionID
}
const safeID = (id: string) => {
  if (!/^art_[0-9a-f-]{36}$/.test(id)) throw new Error("invalid", "Invalid artifact ID")
  return id
}

/** All paths belong to the serving Redcode server, not the browser or a worker. */
export function createStore(data = Global.Path.data) {
  const root = path.join(data, "session-artifacts")
  const sessionRoot = (sessionID: string) => path.join(root, safeSession(sessionID))
  const file = (sessionID: string, id: string) => path.join(sessionRoot(sessionID), safeID(id), "artifact.json")
  const blobs = path.join(root, "blobs")
  const read = async (sessionID: string, id: string): Promise<Info> => {
    const value = Bun.file(file(sessionID, id))
    if (!(await value.exists())) throw new Error("not-found", "Artifact not found in this session")
    return await value.json()
  }

  return {
    async list(sessionID: string): Promise<Info[]> {
      const directory = sessionRoot(sessionID)
      const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return []
        throw error
      })
      const items = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && /^art_[0-9a-f-]{36}$/.test(entry.name))
          .map((entry) => read(sessionID, entry.name)),
      )
      return items.toSorted((a, b) => b.updated - a.updated || a.id.localeCompare(b.id))
    },
    read,
    async publish(input: {
      sessionID: string
      directory: string
      source: string
      title?: string
      entry: string
      id?: string
      expectedRevision?: string
    }): Promise<Info> {
      safeSession(input.sessionID)
      const id = input.id ? safeID(input.id) : `art_${crypto.randomUUID()}`
      if (input.id && !input.expectedRevision) throw new Error("invalid", "An expected revision is required")
      return Flock.withLock(
        `session-artifact:${input.sessionID}:${id}`,
        async () => {
          const previous = input.id ? await read(input.sessionID, id) : undefined
          if (previous && previous.revisions.at(-1)?.id !== input.expectedRevision)
            throw new Error("conflict", "Artifact changed since the selected revision")
          const title = (input.title ?? previous?.title ?? "").trim()
          if (!title || title.length > 200)
            throw new Error("invalid", "Artifact title must contain 1 to 200 characters")
          const source = await DesignFiles.resolve(input.directory, input.source)
          if (!(await stat(source)).isDirectory()) throw new Error("invalid", "Artifact source must be a directory")
          await mkdir(blobs, { recursive: true })
          const files = await Flock.withLock("session-artifact-blobs", () => DesignFiles.snapshot(source, blobs), {
            dir: path.join(root, "locks"),
          })
          const entry = DesignFiles.relative(input.entry)
          if (!Object.hasOwn(files, entry)) throw new Error("invalid", "Artifact entry is not in the snapshot")
          const now = Date.now()
          const revision = { id: `rev_${crypto.randomUUID()}`, created: now, entry, files }
          const result = {
            id,
            sessionID: input.sessionID,
            title,
            created: previous?.created ?? now,
            updated: now,
            revisions: [...(previous?.revisions ?? []), revision],
          }
          await DesignFiles.atomic(file(input.sessionID, id), JSON.stringify(result))
          return result
        },
        { dir: path.join(root, "locks") },
      )
    },
    async content(sessionID: string, id: string, revisionID: string, name: string): Promise<Uint8Array> {
      const artifact = await read(sessionID, id)
      const revision = artifact.revisions.find((item) => item.id === revisionID)
      const hash = revision?.files[DesignFiles.relative(name)]
      if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("not-found", "Artifact file not found")
      return await Bun.file(path.join(blobs, hash)).bytes()
    },
  }
}
