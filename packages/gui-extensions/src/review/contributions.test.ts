import { describe, expect, test } from "bun:test"
import type { MountedSession, ReviewAnnotationContribution, ReviewLensContribution, SessionScreen } from "../sdk"
import { applyReviewLenses, boundReviewAnnotations, loadReviewAnnotations } from "./contributions"

const session = { key: "server/session" } as MountedSession
const screen = {} as SessionScreen

describe("review plugin contributions", () => {
  test("filters files and hunks without mutating the source diff", () => {
    const controller = new AbortController()
    const diff = {
      file: "src/main.ts",
      status: "modified" as const,
      additions: 2,
      deletions: 2,
      patch: [
        "--- a/src/main.ts",
        "+++ b/src/main.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "@@ -8 +8 @@",
        "-remove",
        "+keep",
      ].join("\n"),
    }
    const lens: ReviewLensContribution = {
      id: "focused",
      title: "Focused",
      owner: "fixture:1",
      signal: controller.signal,
      file: (input) => input.file.endsWith(".ts"),
      hunk: (input) => input.hunk.lines.includes("+keep"),
    }

    const result = applyReviewLenses({ diffs: [diff], session, screen, lenses: [lens] })

    expect(result).toHaveLength(1)
    expect(result[0]?.patch).not.toContain("+new")
    expect(result[0]?.patch).toContain("+keep")
    expect(result[0]?.additions).toBe(1)
    expect(diff.patch).toContain("+new")
  })

  test("isolates a broken lens and keeps the review visible", () => {
    const errors: string[] = []
    const lens: ReviewLensContribution = {
      id: "broken",
      title: "Broken",
      owner: "fixture:2",
      signal: new AbortController().signal,
      file: () => {
        throw new Error("fixture failed")
      },
    }
    const diffs = [{ file: "a.ts", patch: "@@ -1 +1 @@\n-a\n+b", additions: 1, deletions: 1, status: "modified" as const }]

    expect(
      applyReviewLenses({ diffs, session, screen, lenses: [lens], report: (owner) => errors.push(owner) }),
    ).toEqual(diffs)
    expect(errors).toEqual(["fixture:2"])
  })

  test("bounds annotation count, size and duplicate ids", () => {
    const values = Array.from({ length: 110 }, (_, index) => ({
      id: index === 1 ? "0" : String(index),
      line: index + 1,
      title: "x".repeat(200),
      body: "y".repeat(3_000),
    }))

    const result = boundReviewAnnotations(values)

    expect(result).toHaveLength(99)
    expect(result[0]?.title).toHaveLength(160)
    expect(result[0]?.body).toHaveLength(2_000)
  })

  test("cancels removed sources and preserves successful peers", async () => {
    const removed = new AbortController()
    const good: ReviewAnnotationContribution = {
      id: "good",
      title: "Good",
      owner: "fixture:good",
      signal: new AbortController().signal,
      load: () => [{ id: "ok", line: 2, title: "Useful" }],
    }
    const gone: ReviewAnnotationContribution = {
      id: "gone",
      title: "Gone",
      owner: "fixture:gone",
      signal: removed.signal,
      load: () => [{ id: "stale", line: 1, title: "Stale" }],
    }
    removed.abort()

    const result = await loadReviewAnnotations({
      sources: [gone, good],
      session,
      screen,
      file: "a.ts",
      patch: "@@ -1 +1 @@",
      signal: new AbortController().signal,
    })

    expect(result).toEqual([{ id: "fixture:good:ok", line: 2, title: "Useful" }])
  })
})
