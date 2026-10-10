export * as PiStore from "./pi-store"

import { mkdirSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"

// Synthetic records shaped like a Pi or oh-my-pi session file, limited to the fields the importer reads.

export type Line = { readonly [key: string]: unknown }

const ms = (time: number) => Date.UTC(2026, 0, 1) + time * 1000
const iso = (time: number) => new Date(ms(time)).toISOString()

export const usage = (output = 1) => ({
  input: 10,
  output,
  cacheRead: 100,
  cacheWrite: 5,
  totalTokens: 116,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
})

export const header = (id: string, cwd: string, time: number, extra: Line = {}): Line => ({
  type: "session",
  version: 3,
  id,
  timestamp: iso(time),
  cwd,
  ...extra,
})

/** oh-my-pi's fixed-width first line carrying the current title. */
export const titleSlot = (title: string): Line => ({
  type: "title",
  v: 1,
  title,
  source: "user",
  updatedAt: iso(0),
  pad: "",
})

export const entry = (type: string, id: string, parent: string | null, time: number, extra: Line = {}): Line => ({
  type,
  id,
  parentId: parent,
  timestamp: iso(time),
  ...extra,
})

const message = (id: string, parent: string | null, time: number, value: Line) =>
  entry("message", id, parent, time, { message: { timestamp: ms(time), ...value } })

export const user = (id: string, parent: string | null, time: number, content: unknown, extra: Line = {}) =>
  message(id, parent, time, { role: "user", content, ...extra })

export const assistant = (
  id: string,
  parent: string | null,
  time: number,
  content: ReadonlyArray<unknown>,
  extra: Line = {},
) =>
  message(id, parent, time, {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-test-1",
    usage: usage(),
    stopReason: "stop",
    ...extra,
  })

export const result = (
  id: string,
  parent: string,
  time: number,
  call: { readonly id: string; readonly name: string },
  content: ReadonlyArray<unknown>,
  extra: Line = {},
) =>
  message(id, parent, time, {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content,
    isError: false,
    ...extra,
  })

export const raw = (id: string, parent: string | null, time: number, value: Line) => message(id, parent, time, value)

export const jsonl = (records: ReadonlyArray<Line>) => records.map((record) => JSON.stringify(record)).join("\n") + "\n"

/** Pi's bucket name for a working directory. */
export const bucket = (cwd: string) => `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`

/** Write a session, and optionally its subagent transcripts, into a session store root. */
export function write(
  root: string,
  input: {
    readonly bucket?: string
    readonly file: string
    readonly records: ReadonlyArray<Line>
    readonly agents?: ReadonlyArray<{ readonly id: string; readonly records: ReadonlyArray<Line> }>
    readonly blobs?: ReadonlyArray<{ readonly hash: string; readonly bytes: Uint8Array }>
  },
) {
  const dir = input.bucket ? path.join(root, input.bucket) : root
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${input.file}.jsonl`)
  writeFileSync(file, jsonl(input.records))
  // Pi appends as it goes, so the file was last modified at its newest entry. Pin that explicitly:
  // fixtures written back to back otherwise share an mtime on file systems with coarse timestamps.
  const newest = Math.max(
    ...input.records.map((record) => (typeof record.timestamp === "string" ? Date.parse(record.timestamp) : 0)),
  )
  if (newest > 0) utimesSync(file, new Date(newest), new Date(newest))
  if (input.agents?.length) {
    const artifacts = path.join(dir, input.file)
    mkdirSync(artifacts, { recursive: true })
    input.agents.forEach((agent) => writeFileSync(path.join(artifacts, `${agent.id}.jsonl`), jsonl(agent.records)))
  }
  if (!input.blobs?.length) return
  const blobs = path.join(root, "..", "blobs")
  mkdirSync(blobs, { recursive: true })
  input.blobs.forEach((blob) => writeFileSync(path.join(blobs, blob.hash), blob.bytes))
}
