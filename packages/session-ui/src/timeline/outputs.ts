import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { currentToolFailed, currentToolInput, currentToolMetadata, currentToolOutput } from "../message/current-tool-state"
import { editedFiles, stepKind, toolPaths, type FileChange } from "./turn"

export type SubagentStatus = "running" | "done" | "failed"

/** One subagent the session started, by its child session when the call recorded one. */
export type SubagentOutput = {
  /** The child session, absent while the call is still being written. */
  sessionID?: string
  /** The agent the call asked for, such as `explore`. */
  agent?: string
  /** The call's description, the subagent's task in a few words. */
  title: string
  status: SubagentStatus
}

/** A web page the session fetched, or a search it ran with how many results came back. */
export type WebSource =
  | { kind: "fetch"; url: string; failed: boolean }
  | { kind: "search"; query: string; results: number; failed: boolean }

/** A design the session published for review. */
export type DesignOutput = { id: string; title: string }

/** What a session produced and drew on, for the session's Outputs / Subagents / Sources card. */
export type SessionOutputs = {
  /** Files the session created or changed, largest change first. */
  files: FileChange[]
  designs: DesignOutput[]
  subagents: SubagentOutput[]
  web: WebSource[]
  /** Distinct files the session read. */
  filesRead: number
}

/**
 * Folds a session's projected messages into its outputs, subagents and sources. Repeated calls on one subagent,
 * page, search or design collapse into one entry that keeps the latest status.
 */
export function sessionOutputs(messages: readonly SessionMessageInfo[]): SessionOutputs {
  const tools = messages.flatMap((message) =>
    message.type === "assistant"
      ? message.content.filter((content): content is SessionMessageAssistantTool => content.type === "tool")
      : [],
  )
  const subagents = new Map<string, SubagentOutput>()
  const web = new Map<string, WebSource>()
  const designs = new Map<string, DesignOutput>()
  const read = new Set<string>()

  tools.forEach((tool) => {
    const input = currentToolInput(tool)
    const kind = stepKind(tool.name)

    if (kind === "agent") {
      const entry = subagent(tool, input)
      const key = entry.sessionID ?? `tool:${tool.id}`
      const previous = subagents.get(key)
      subagents.set(key, previous ? { ...previous, status: entry.status, agent: previous.agent ?? entry.agent } : entry)
      return
    }

    if (kind === "read" && tool.state.status === "completed") {
      toolPaths(tool).forEach((path) => read.add(path))
      return
    }

    if (tool.name === "webfetch" && typeof input.url === "string" && input.url) {
      web.set(`fetch:${input.url}`, { kind: "fetch", url: input.url, failed: currentToolFailed(tool) })
      return
    }

    if (tool.name === "websearch" && typeof input.query === "string" && input.query) {
      web.set(`search:${input.query}`, {
        kind: "search",
        query: input.query,
        results: searchResults(tool),
        failed: currentToolFailed(tool),
      })
      return
    }

    if (tool.name === "design_preview" && tool.state.status === "completed") {
      const metadata = currentToolMetadata(tool)
      const id = typeof metadata.id === "string" ? metadata.id : typeof input.id === "string" ? input.id : undefined
      if (!id) return
      const title = typeof input.name === "string" && input.name ? input.name : (designs.get(id)?.title ?? id)
      designs.delete(id)
      designs.set(id, { id, title })
    }
  })

  return {
    files: editedFiles(tools),
    // The latest preview of each design first.
    designs: [...designs.values()].reverse(),
    subagents: [...subagents.values()],
    web: [...web.values()],
    filesRead: read.size,
  }
}

/** How many entries a group of outputs holds, for the card's collapsed summary. */
export function sessionOutputCounts(outputs: SessionOutputs) {
  return {
    outputs: outputs.files.length + outputs.designs.length,
    subagents: outputs.subagents.length,
    sources: outputs.web.length + (outputs.filesRead > 0 ? 1 : 0),
  }
}

function subagent(tool: SessionMessageAssistantTool, input: Record<string, unknown>): SubagentOutput {
  const metadata = currentToolMetadata(tool)
  // The current tool records `sessionID`; the earlier `task` tool recorded `sessionId`.
  const sessionID = [metadata.sessionID, metadata.sessionId].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
  const agent = [input.agent, input.subagent_type].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
  const title = typeof input.description === "string" && input.description ? input.description : (agent ?? "")

  return { sessionID, agent, title, status: subagentStatus(tool, metadata) }
}

function subagentStatus(tool: SessionMessageAssistantTool, metadata: Record<string, unknown>): SubagentStatus {
  if (tool.state.status === "streaming" || tool.state.status === "running") return "running"
  if (tool.state.status === "error") return "failed"
  // A subagent moved to the background completes its call while the child keeps working.
  if (metadata.status === "running") return "running"
  if (metadata.status === "error" || metadata.status === "failed") return "failed"
  return "done"
}

// A search's result list is a markdown heading per result, `## [title](url)`; older providers listed bare URLs.
function searchResults(tool: SessionMessageAssistantTool) {
  const output = currentToolOutput(tool)
  if (!output) return 0
  const headings = output.match(/^## \[[^\]]*\]\([^)]+\)/gm)?.length ?? 0
  if (headings > 0) return headings
  return output.match(/^https?:\/\/\S+$/gm)?.length ?? 0
}
