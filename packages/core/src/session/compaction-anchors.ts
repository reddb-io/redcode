/**
 * The deterministic block appended to a compaction summary. Built by code from the history, not
 * by the model, so the facts a summary most often loses (which files were touched, the exact
 * identifiers the person typed, what they actually asked) survive every compaction verbatim.
 */
import { Token } from "../util/token"

export const OPEN = "<session-anchors>"
export const CLOSE = "</session-anchors>"
/** Upper bound of the whole block. */
export const MAX_TOKENS = 4_000
/** Share of the block the person's own messages may take. */
const USER_MESSAGES_TOKENS = 2_000
const MAX_FILES = 40
const MAX_IDENTIFIERS = 40
const MAX_MESSAGE_TOKENS = 600

export type FileOperation = { readonly path: string; readonly kind: "read" | "modified" }

export type Input = {
  /** The person's own messages, oldest first. */
  readonly userMessages: readonly string[]
  readonly files: readonly FileOperation[]
  readonly git?: { readonly branch?: string; readonly head?: string }
  /** Whether the model can search the compacted-away history with `session_history`. */
  readonly historyTool?: boolean
  readonly maxTokens?: number
}

// Unicode-aware: paths and repository names may be written in any script.
const URL = /\bhttps?:\/\/[^\s<>()"'`]+/gu
const ISSUE = /(?:^|[\s(])(?:[\p{L}\p{N}_.-]+\/[\p{L}\p{N}_.-]+)?#\d+(?![\p{L}\p{N}_])/gu
const SHA = /(?<![\p{L}\p{N}_])[0-9a-f]{7,40}(?![\p{L}\p{N}_])/gu
// Something with a slash or a file extension; URLs are matched above and removed first.
const PATH =
  /(?:^|[\s("'`])((?:~|\.{1,2})?\/?[\p{L}\p{N}_@.-]+(?:\/[\p{L}\p{N}_@.-]+)+\/?|[\p{L}\p{N}_-]+\.(?:[a-z][a-z0-9]{0,5}))(?=$|[\s)"'`,:;])/giu

/** Paths, URLs, PR/issue numbers and SHAs that appear in a text, in order of first appearance. */
export function identifiers(text: string) {
  const found: string[] = []
  const urls = text.match(URL) ?? []
  found.push(...urls.map((url) => url.replace(/[.,;:]+$/, "")))
  const rest = urls.reduce((result, url) => result.replace(url, " "), text)
  found.push(...(rest.match(ISSUE) ?? []).map((item) => item.trim().replace(/^\(/, "")))
  found.push(...(rest.match(SHA) ?? []).filter((sha) => /\d/.test(sha) && /[a-f]/.test(sha)))
  for (const match of rest.matchAll(PATH)) {
    const value = match[1]!.replace(/[.,;:]+$/, "")
    // A bare "e.g" or "v1.2" is not a path.
    if (!value.includes("/") && /^\d|^(e\.g|i\.e|etc)$/i.test(value)) continue
    found.push(value)
  }
  return [...new Set(found)]
}

function bounded(text: string, tokens: number) {
  if (Token.estimate(text) <= tokens) return text
  return `${Array.from(text)
    .slice(0, tokens * 4)
    .join("")}…`
}

/** The anchors block, or an empty string when there is nothing to anchor. */
export function build(input: Input) {
  const counts = new Map<string, { read: number; modified: number }>()
  for (const file of input.files) {
    const entry = counts.get(file.path) ?? { read: 0, modified: 0 }
    entry[file.kind === "read" ? "read" : "modified"]++
    counts.set(file.path, entry)
  }
  const describe = (kind: "read" | "modified") =>
    [...counts.entries()]
      .filter(([, entry]) => entry[kind] > 0)
      .slice(-MAX_FILES)
      .map(([path, entry]) => `- ${path} (${entry[kind]}×)`)
  const read = describe("read")
  const modified = describe("modified")
  const ids = [...new Set(input.userMessages.flatMap(identifiers))].slice(-MAX_IDENTIFIERS)

  const max = input.maxTokens ?? MAX_TOKENS
  const messages: string[] = []
  let budget = Math.min(USER_MESSAGES_TOKENS, Math.floor(max / 2))
  for (const text of [...input.userMessages].reverse()) {
    const trimmed = text.trim()
    if (!trimmed) continue
    const quoted = `- ${bounded(trimmed, MAX_MESSAGE_TOKENS).replaceAll("\n", "\n  ")}`
    const cost = Token.estimate(quoted)
    if (cost > budget) break
    budget -= cost
    messages.push(quoted)
  }

  const git =
    input.git?.branch || input.git?.head
      ? `Git: ${[input.git.branch && `branch ${input.git.branch}`, input.git.head && `HEAD ${input.git.head}`]
          .filter(Boolean)
          .join(", ")}`
      : ""
  const render = (quoted: readonly string[]) =>
    [
      modified.length > 0 ? ["Files modified:", ...modified].join("\n") : "",
      read.length > 0 ? ["Files read:", ...read].join("\n") : "",
      git,
      ids.length > 0 ? ["Identifiers from the user's messages:", ...ids.map((id) => `- ${id}`)].join("\n") : "",
      quoted.length > 0 ? ["The user's messages, newest first:", ...quoted].join("\n") : "",
    ].filter(Boolean)
  if (render(messages).length === 0) return ""
  const footer = input.historyTool
    ? "Messages from before this summary are no longer in context. If a detail you need is missing, search them with the session_history tool."
    : ""
  const body = (quoted: readonly string[]) => [...render(quoted), footer].filter(Boolean).join("\n\n")
  // Drop the oldest quoted messages until the block fits, then cut whatever still does not.
  while (messages.length > 0 && Token.estimate(body(messages)) > max) messages.pop()
  return `${OPEN}\n${bounded(body(messages), max)}\n${CLOSE}`
}

/** Removes an earlier anchors block from a summary, so it is rebuilt instead of summarized again. */
export function strip(text: string) {
  return text.replace(new RegExp(`\\s*${OPEN}[\\s\\S]*?${CLOSE}\\s*`, "g"), "\n").trim()
}

export * as CompactionAnchors from "./compaction-anchors"
