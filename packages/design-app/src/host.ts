export * as DesignAppHost from "./host"

import path from "node:path"
import { realpath, stat } from "node:fs/promises"
import type { Design } from "@reddb-io/redcode-schema/design"
import { DesignBuild } from "@reddb-io/redcode-core/design/build"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"

/**
 * The redcode that runs a session's conversation, reached through its `design.host` routes: feedback,
 * approval, the conversation feed and permission prompts only exist in that process.
 */
export interface Host {
  readonly url: string
  readonly authorization?: string
}

export function request(
  host: Host,
  sessionID: string,
  route: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
) {
  return fetch(new URL(`/api/design/session/${encodeURIComponent(sessionID)}${route}`, host.url), {
    ...init,
    headers: {
      ...(host.authorization ? { authorization: host.authorization } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
  })
}

export interface Permission {
  readonly permission: string
  readonly patterns: readonly string[]
  readonly always?: readonly string[]
  readonly metadata?: Record<string, unknown>
}

/** Asks through the session's permission queue; waits while the user decides. */
export async function ask(host: Host, sessionID: string, input: Permission, signal?: AbortSignal) {
  const response = await request(host, sessionID, "/permission", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) throw new Error(`redcode did not answer the ${input.permission} permission (${response.status})`)
  const answer: unknown = await response.json()
  return typeof answer === "object" && answer !== null && "granted" in answer && answer.granted === true
}

/**
 * A build's read check: every file a revision imports is a read of the session, outside its directory
 * an external one too, asked with the session agent's rules as the redcode tool would. A refusal rejects.
 */
export function reader(host: Host, sessionID: string, directory: string) {
  return async (file: string, signal?: AbortSignal) => {
    const resolved = await realpath(file)
    const refused = (permission: string) => new Error(`Permission ${permission} was refused for ${resolved}`)
    if (!FSUtil.contains(directory, resolved)) {
      const patterns = [path.join(path.dirname(resolved), "*")]
      const granted = await ask(
        host,
        sessionID,
        { permission: "external_directory", patterns, always: patterns, metadata: { path: resolved } },
        signal,
      )
      if (!granted) throw refused("external_directory")
    }
    const granted = await ask(
      host,
      sessionID,
      { permission: "read", patterns: [resolved], always: [resolved], metadata: { path: resolved } },
      signal,
    )
    if (!granted) throw refused("read")
  }
}

/**
 * Running the project's PostCSS pipeline executes its configuration in this process, which a read grant
 * does not cover: a distinct permission names the files. A refusal builds without it.
 */
export async function tooling(host: Host, sessionID: string, document: Design.Info) {
  const files = await DesignBuild.tooling(document)
  if (!files.length) return false
  const patterns = await Promise.all(
    files.map(async (file) => ((await stat(file)).isDirectory() ? path.join(file, "*") : file)),
  )
  return ask(host, sessionID, {
    permission: "project_tooling",
    patterns,
    always: patterns,
    metadata: {
      origin: "design.publish",
      reason: `execute project tooling: ${files.map((file) => path.basename(file)).join(", ")} (runs in the design app)`,
    },
  })
}
