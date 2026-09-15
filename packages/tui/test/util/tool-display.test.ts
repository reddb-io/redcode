import { describe, expect, test } from "bun:test"
import { toolDisplayMetadata, toolSearchSummary, webSearchProviderLabel } from "../../src/util/tool-display"

describe("toolSearchSummary", () => {
  test("client-side tool_search", () => {
    expect(toolSearchSummary({ query: "open issues" }, { loaded: ["a", "b"] })).toEqual({
      query: "open issues",
      loaded: 2,
    })
    expect(toolSearchSummary({ select: ["github_issue_read"] }, {})).toEqual({
      query: "github_issue_read",
      loaded: undefined,
    })
  })

  test("Anthropic tool search, in the AI SDK and the wire shape", () => {
    expect(
      toolSearchSummary({ query: "issue" }, {}, JSON.stringify([{ type: "tool_reference", toolName: "x" }])),
    ).toEqual({ query: "issue", loaded: 1 })
    expect(
      toolSearchSummary({ pattern: "issue.*" }, {}, JSON.stringify({ tool_references: [{ tool_name: "x" }, {}] })),
    ).toEqual({ query: "issue.*", loaded: 2 })
  })

  test("OpenAI hosted tool search", () => {
    expect(
      toolSearchSummary({ arguments: { paths: ["github"] } }, {}, JSON.stringify({ tools: [{ type: "namespace" }] })),
    ).toEqual({ query: "github", loaded: 1 })
    expect(toolSearchSummary({}, {}, "not json")).toEqual({ query: undefined, loaded: undefined })
  })
})

describe("webSearchProviderLabel", () => {
  test("labels known providers", () => {
    expect(webSearchProviderLabel("parallel")).toBe("Parallel Web Search")
    expect(webSearchProviderLabel("exa")).toBe("Exa Web Search")
  })

  for (const [name, provider] of [
    ["undefined", undefined],
    ["null", null],
    ["an object", {}],
    ["an array", []],
    ["a number", 1],
    ["an unexpected string", "other"],
  ] as const) {
    test(`uses the generic label for ${name}`, () => {
      expect(webSearchProviderLabel(provider)).toBe("Web Search")
    })
  }
})

describe("toolDisplayMetadata", () => {
  test("returns structured metadata for non-pending states", () => {
    const structured = { provider: "parallel", numResults: 3 }

    expect(toolDisplayMetadata({ status: "running", structured })).toBe(structured)
    expect(toolDisplayMetadata({ status: "completed", structured })).toBe(structured)
    expect(toolDisplayMetadata({ status: "error", structured })).toBe(structured)
  })

  test("does not expose pending or malformed metadata", () => {
    expect(toolDisplayMetadata({ status: "pending", structured: { provider: "exa" } })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed" })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed", structured: null })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed", structured: [] })).toEqual({})
    expect(toolDisplayMetadata(undefined)).toEqual({})
  })
})
