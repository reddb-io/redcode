import { describe, expect, test } from "bun:test"
import { createPluginRuntime } from "../src/plugin/runtime"
import { fitStatuslineSegments, mergeStatuslineSegments } from "../src/statusline"

describe("statusline", () => {
  test("replaces base segments by stable id", () => {
    expect(
      mergeStatuslineSegments(
        [
          { id: "project", text: "opencode", order: 10 },
          { id: "model", text: "sonnet", order: 20 },
        ],
        [[{ id: "project", text: "red-code", order: 10 }]],
      ),
    ).toEqual([
      { id: "project", text: "red-code", order: 10 },
      { id: "model", text: "sonnet", order: 20 },
    ])
  })

  test("shortens then drops optional segments before required ones", () => {
    const segments = [
      { id: "project", text: "long-project", short: "repo", importance: "required" as const, order: 10 },
      { id: "model", text: "claude-opus", short: "opus", importance: "normal" as const, order: 20 },
      { id: "version", text: "v1.18.18", importance: "optional" as const, order: 30 },
    ]

    expect(fitStatuslineSegments(segments, 16).map((item) => item.text)).toEqual(["repo", "opus"])
    expect(fitStatuslineSegments(segments, 5).map((item) => item.text)).toEqual(["repo"])
  })

  test("updates and disposes plugin contributions independently", () => {
    const runtime = createPluginRuntime()
    const first = runtime.registerStatusline("dev", { segments: [{ id: "one", text: "one" }] })
    const second = runtime.registerStatusline("dev", { segments: [{ id: "two", text: "two" }] })

    first.update({ segments: [{ id: "one", text: "updated" }] })
    expect(runtime.statusline().map((item) => item.contribution.segments?.[0]?.text)).toEqual(["two", "updated"])

    first.dispose()
    expect(runtime.statusline().map((item) => item.contribution.segments?.[0]?.text)).toEqual(["two"])
    second.dispose()
    expect(runtime.statusline()).toEqual([])
  })
})
