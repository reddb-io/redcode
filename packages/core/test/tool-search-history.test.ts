import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { ToolSearch } from "../src/tool/tool-search"
import type { SessionMessage } from "../src/session/message"

const at = (millis: number) => DateTime.makeUnsafe(millis)

const tool = (
  name: string,
  time: number,
  state: Partial<SessionMessage.ToolStateCompleted> & { structured?: Record<string, unknown> } = {},
): SessionMessage.AssistantTool =>
  ({
    type: "tool",
    id: `call_${name}_${time}`,
    name,
    state: {
      status: "completed",
      input: {},
      content: [],
      structured: state.structured ?? {},
    },
    time: { created: at(time), ran: at(time) },
  }) as SessionMessage.AssistantTool

const assistant = (time: number, content: SessionMessage.AssistantTool[]): SessionMessage.Message =>
  ({
    type: "assistant",
    id: `msg_assistant_${time}`,
    content,
    time: { created: at(time) },
  }) as unknown as SessionMessage.Message

const compaction = (time: number, tools?: { loaded: string[]; mcpDeferred: boolean }): SessionMessage.Message =>
  ({
    type: "compaction",
    id: `msg_compaction_${time}`,
    reason: "auto",
    summary: "summary",
    recent: "recent",
    ...(tools ? { tools } : {}),
    time: { created: at(time) },
  }) as unknown as SessionMessage.Message

const search = (time: number, loaded: string[], mcpDeferred = true) =>
  assistant(time, [tool(ToolSearch.TOOL_ID, time, { structured: { loaded, mcpDeferred } })])

describe("tool_search over v2 history", () => {
  test("reads what a search loaded, in the order the session loaded it", () => {
    const history = [search(10, ["github_list_issues"]), search(20, ["slack_post_message"])]
    const names = ToolSearch.namesInHistory(history)

    expect([...names]).toEqual(["github_list_issues", "slack_post_message"])
    expect(ToolSearch.loadedFromHistory(history, names)).toEqual(["github_list_issues", "slack_post_message"])
  })

  test("counts a deferred tool the history already called, so a replayed call stays advertised", () => {
    const history = [assistant(5, [tool("github_merge_pull_request", 5)])]

    expect(ToolSearch.loadedFromHistory(history, ToolSearch.namesInHistory(history))).toEqual([
      "github_merge_pull_request",
    ])
  })

  test("leaves a tool the provider's own search loaded deferred", () => {
    const history = [search(10, ["github_list_issues"]), assistant(20, [tool("github_list_issues", 20)])]
    const names = ToolSearch.namesInHistory(history)

    expect(ToolSearch.loadedFromHistory(history, names, new Set(["github_list_issues"]))).toEqual([
      "github_list_issues",
    ])
  })

  test("sees deferral tripping, from a search call or from a compaction that carried it", () => {
    expect(ToolSearch.trippedInHistory([search(10, ["github_list_issues"], true)])).toBe(true)
    // Design tools alone keep `tool_search` present, so the call itself is not enough.
    expect(ToolSearch.trippedInHistory([search(10, ["design_preview"], false)])).toBe(false)
    expect(ToolSearch.trippedInHistory([compaction(10, { loaded: [], mcpDeferred: true })])).toBe(true)
  })

  test("carries the loaded set across a compaction, oldest first", () => {
    // What `SessionCompaction.publish` records, from history that still includes the previous
    // compaction message: the runner's window starts at it, so earlier loads survive through it.
    const carried = ToolSearch.carried([
      compaction(10, { loaded: ["github_list_issues"], mcpDeferred: true }),
      search(20, ["slack_post_message"]),
    ])

    expect(carried).toEqual({ loaded: ["github_list_issues", "slack_post_message"], mcpDeferred: true })
  })

  test("keeps a tool loaded before a compaction ahead of one loaded after it", () => {
    // The compaction message carries what was already loaded, so it is stamped with its own time:
    // everything it carries sorts ahead of whatever the session loads afterwards, whatever order
    // the projected rows arrive in.
    const history = [
      search(50, ["slack_post_message"]),
      compaction(10, { loaded: ["github_list_issues"], mcpDeferred: true }),
    ]
    const names = ToolSearch.namesInHistory(history)

    expect(ToolSearch.loadedFromHistory(history, names)).toEqual(["github_list_issues", "slack_post_message"])
  })
})
