export * as ClaudeCodeStore from "./claude-code-store"

import { mkdirSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"

// Synthetic records shaped like a Claude Code transcript, limited to the fields the importer reads.

export type Line = { readonly [key: string]: unknown }

const iso = (time: number) => new Date(Date.UTC(2026, 0, 1) + time * 1000).toISOString()

export const entry = (
  session: string,
  cwd: string,
  type: string,
  uuid: string,
  parent: string | null,
  time: number,
  extra: Line = {},
): Line => ({
  type,
  uuid,
  parentUuid: parent,
  isSidechain: false,
  sessionId: session,
  cwd,
  gitBranch: "main",
  version: "2.1.0",
  userType: "external",
  timestamp: iso(time),
  ...extra,
})

/** A transcript builder bound to one session and directory. */
export function transcript(session: string, cwd: string, sidechain?: { readonly agentId: string }) {
  const base = (type: string, uuid: string, parent: string | null, time: number, extra: Line = {}) =>
    entry(session, cwd, type, uuid, parent, time, {
      ...(sidechain ? { isSidechain: true, agentId: sidechain.agentId } : {}),
      ...extra,
    })
  return {
    user: (uuid: string, parent: string | null, time: number, content: unknown, extra: Line = {}) =>
      base("user", uuid, parent, time, { message: { role: "user", content }, ...extra }),
    assistant: (
      uuid: string,
      parent: string | null,
      time: number,
      response: { readonly id: string; readonly block: unknown; readonly stop?: string; readonly output?: number },
      extra: Line = {},
    ) =>
      base("assistant", uuid, parent, time, {
        requestId: `req_${response.id}`,
        message: {
          id: response.id,
          type: "message",
          role: "assistant",
          model: "claude-test-1",
          content: [response.block],
          stop_reason: response.stop ?? null,
          usage: {
            input_tokens: 10,
            output_tokens: response.output ?? 1,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 5,
          },
        },
        ...extra,
      }),
    result: (
      uuid: string,
      parent: string,
      time: number,
      toolUseID: string,
      content: unknown,
      extra: { readonly isError?: boolean; readonly toolUseResult?: unknown } = {},
    ) =>
      base("user", uuid, parent, time, {
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: toolUseID, content, ...(extra.isError ? { is_error: true } : {}) },
          ],
        },
        toolUseResult: extra.toolUseResult ?? { stdout: "", stderr: "", interrupted: false },
      }),
    system: (uuid: string, parent: string | null, time: number, subtype: string, extra: Line = {}) =>
      base("system", uuid, parent, time, { subtype, level: "info", ...extra }),
    attachment: (uuid: string, parent: string, time: number, attachment: Line) =>
      base("attachment", uuid, parent, time, { attachment }),
  }
}

export const jsonl = (records: ReadonlyArray<Line>) => records.map((record) => JSON.stringify(record)).join("\n") + "\n"

/** Write a session, and optionally its subagents, into a Claude Code config directory. */
export function write(
  root: string,
  input: {
    readonly cwd: string
    readonly session: string
    readonly records: ReadonlyArray<Line>
    readonly agents?: ReadonlyArray<{
      readonly id: string
      readonly meta?: Line
      readonly records: ReadonlyArray<Line>
    }>
  },
) {
  const project = path.join(root, "projects", input.cwd.replace(/[^A-Za-z0-9]/g, "-"))
  mkdirSync(project, { recursive: true })
  const file = path.join(project, `${input.session}.jsonl`)
  writeFileSync(file, jsonl(input.records))
  // Claude Code appends as it goes, so the file was last modified at its newest record. Pin that explicitly:
  // fixtures written back to back otherwise share an mtime on file systems with coarse timestamps.
  const newest = Math.max(
    ...input.records.map((record) => (typeof record.timestamp === "string" ? Date.parse(record.timestamp) : 0)),
  )
  if (newest > 0) utimesSync(file, new Date(newest), new Date(newest))
  if (!input.agents?.length) return
  const agents = path.join(project, input.session, "subagents")
  mkdirSync(agents, { recursive: true })
  input.agents.forEach((agent) => {
    writeFileSync(path.join(agents, `agent-${agent.id}.jsonl`), jsonl(agent.records))
    if (agent.meta) writeFileSync(path.join(agents, `agent-${agent.id}.meta.json`), JSON.stringify(agent.meta))
  })
}
