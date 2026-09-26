export * as DesignAppHost from "./app-host.js"

import { realpath } from "node:fs/promises"
import { Option, Schema } from "effect"
import type { Design } from "@opencode/schema/design"
import type { Read } from "./build.js"

/** The owning redcode server keeps permission decisions in its Session process. */
export interface Host {
  readonly url: string
  readonly authorization?: string
}

const Reply = Schema.Struct({ granted: Schema.Boolean })

export function reader(host: Host, sessionID: Design.Info["sessionID"]): Read {
  return async (file, signal) => {
    const canonical = await realpath(file)
    const granted = await ask(host, sessionID, { kind: "read", path: canonical }, signal)
    if (!granted) throw new Error(`Read permission was refused for ${canonical}`)
  }
}

export function tooling(host: Host, document: Design.Info) {
  return ask(host, document.sessionID, { kind: "tooling", designID: document.id })
}

async function ask(
  host: Host,
  sessionID: Design.Info["sessionID"],
  input: { readonly kind: "read"; readonly path: string } | { readonly kind: "tooling"; readonly designID: Design.ID },
  signal?: AbortSignal,
) {
  const response = await fetch(new URL(`/design/session/${encodeURIComponent(sessionID)}/permission`, host.url), {
    method: "POST",
    body: JSON.stringify(input),
    signal,
    headers: {
      "content-type": "application/json",
      ...(host.authorization ? { authorization: host.authorization } : {}),
    },
  })
  if (!response.ok) throw new Error(`redcode did not answer the Design permission (${response.status})`)
  const reply = Option.getOrUndefined(Schema.decodeUnknownOption(Reply)(await response.json()))
  if (!reply) throw new Error("redcode answered the Design permission without a decision")
  return reply.granted
}
