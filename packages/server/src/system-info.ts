import type { SystemInfo } from "@opencode/protocol/groups/server"

/**
 * The database as a System view shows it. A remote database is named by its protocol and host only: its URL can carry
 * a path, and its token never leaves the options. A local one is sized from its file and write-ahead log.
 */
export async function database(options: { readonly path?: string; readonly url?: string } | undefined) {
  if (options?.url) {
    const url = new URL(options.url)
    return { kind: "remote", protocol: url.protocol.replace(/:$/, ""), host: url.host } satisfies SystemInfo["database"]
  }
  if (!options?.path || options.path === ":memory:") return { kind: "memory" } satisfies SystemInfo["database"]
  const { stat } = await import("node:fs/promises")
  const size = await stat(options.path).then(
    (entry) => entry.size,
    () => undefined,
  )
  const wal = await stat(`${options.path}-wal`).then(
    (entry) => entry.size,
    () => undefined,
  )
  return {
    kind: "local",
    path: options.path,
    ...(size === undefined ? {} : { size }),
    ...(wal === undefined ? {} : { wal }),
  } satisfies SystemInfo["database"]
}

/** The runtime this process runs on, such as `bun 1.4.2`. */
export function runtime() {
  const bun = process.versions.bun
  return bun ? `bun ${bun}` : `node ${process.versions.node ?? "unknown"}`
}
