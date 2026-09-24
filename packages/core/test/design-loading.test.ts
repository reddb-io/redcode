import { describe, expect, test } from "bun:test"
import { previewLoading, type LoadingEvent, type LoadingState } from "@reddb-io/redcode-design/loading"
import { designWaiting } from "@reddb-io/redcode-design/waiting"
import { reviewCopy } from "@reddb-io/redcode-design/copy"

const logic = previewLoading()
const run = (events: LoadingEvent[], from: LoadingState = logic.initial(0)) => events.reduce(logic.reduce, from)
const visible = (state: LoadingState) => ({ phase: state.phase, stage: state.stage })

describe("preview loading states", () => {
  test("a page opens loading the revision, never on a blank frame", () => {
    expect(visible(logic.initial(0))).toEqual({ phase: "loading", stage: "revision" })
  })

  test("a design without a revision shows the zero state with the agent's live activity", () => {
    const empty = run([{ type: "design", revision: undefined, at: 1 }])
    expect(empty.phase).toBe("empty")
    expect(empty.agent).toBe("idle")
    const thinking = run([{ type: "agent", state: "working" }], empty)
    expect(thinking.agent).toBe("thinking")
    const tool = run([{ type: "tool", tool: "design_preview", status: "running" }], thinking)
    expect({ agent: tool.agent, tool: tool.tool }).toEqual({ agent: "tool", tool: "design_preview" })
    // Another tool finishing leaves the running one in place; its own end goes back to thinking.
    expect(run([{ type: "tool", tool: "read", status: "done" }], tool).tool).toBe("design_preview")
    expect(run([{ type: "tool", tool: "design_preview", status: "done" }], tool).agent).toBe("thinking")
    expect(run([{ type: "agent", state: "idle" }], tool)).toMatchObject({ agent: "idle", tool: "" })
    // The first revision leaves the zero state.
    expect(visible(run([{ type: "design", revision: "rev_1", at: 2 }], tool))).toEqual({
      phase: "loading",
      stage: "revision",
    })
  })

  test("a preview walks through the build stages to a ready frame", () => {
    const steps: LoadingEvent[] = [
      { type: "design", revision: "rev_1", at: 1 },
      { type: "load", revision: "rev_1", at: 2 },
      { type: "build", revision: "rev_1", stage: "queued" },
      { type: "build", revision: "rev_1", stage: "tools" },
      { type: "build", revision: "rev_1", stage: "building" },
      { type: "document", revision: "rev_1" },
      { type: "frame" },
      { type: "ready" },
    ]
    const seen = steps.map((_, index) => visible(run(steps.slice(0, index + 1))))
    expect(seen).toEqual([
      { phase: "loading", stage: "revision" },
      { phase: "loading", stage: "queued" },
      { phase: "loading", stage: "queued" },
      { phase: "loading", stage: "tools" },
      { phase: "loading", stage: "build" },
      { phase: "loading", stage: "assets" },
      { phase: "loading", stage: "runtime" },
      { phase: "ready", stage: "runtime" },
    ])
  })

  test("a late build status never moves a load back, and the runtime may be ready before the frame's load event", () => {
    const assets = run([
      { type: "load", revision: "rev_1", at: 0 },
      { type: "build", revision: "rev_1", stage: "building" },
      { type: "document", revision: "rev_1" },
    ])
    expect(run([{ type: "build", revision: "rev_1", stage: "tools" }], assets).stage).toBe("assets")
    expect(run([{ type: "build", revision: "rev_1", stage: "queued" }], assets).stage).toBe("assets")
    expect(run([{ type: "ready" }], assets).phase).toBe("ready")
    // Ready before any document means nothing: the frame on screen is not this revision yet.
    expect(run([{ type: "load", revision: "rev_1", at: 0 }, { type: "ready" }]).phase).toBe("loading")
    // Another revision's status is ignored.
    expect(
      run([
        { type: "load", revision: "rev_2", at: 0 },
        { type: "build", revision: "rev_1", stage: "tools" },
      ]).stage,
    ).toBe("queued")
  })

  test("a failed build shows its summary; a status left over from an earlier attempt does not", () => {
    const loading = run([{ type: "load", revision: "rev_1", at: 0 }])
    expect(run([{ type: "build", revision: "rev_1", stage: "failed", message: "old" }], loading).phase).toBe("loading")
    const failed = run([{ type: "failed", revision: "rev_1", message: "missing.css" }], loading)
    expect({ phase: failed.phase, message: failed.message }).toEqual({ phase: "error", message: "missing.css" })
    // A late document of the failed load does not hide the error; Retry loads again.
    expect(run([{ type: "document", revision: "rev_1" }], failed).phase).toBe("error")
    expect(visible(run([{ type: "load", revision: "rev_1", at: 5 }], failed))).toEqual({
      phase: "loading",
      stage: "queued",
    })
  })

  test("a live reload keeps the frame on screen until the new document arrives", () => {
    const ready = run([
      { type: "load", revision: "rev_1", at: 0 },
      { type: "document", revision: "rev_1" },
      { type: "ready" },
    ])
    const reloading = run([{ type: "load", revision: "rev_2", at: 10, quiet: true }], ready)
    expect(reloading.phase).toBe("ready")
    expect(run([{ type: "build", revision: "rev_2", stage: "tools" }], reloading).phase).toBe("ready")
    expect(visible(run([{ type: "document", revision: "rev_2" }], reloading))).toEqual({
      phase: "loading",
      stage: "assets",
    })
    // A reload the reader asked for shows the loading state at once.
    expect(run([{ type: "load", revision: "rev_1", at: 10 }], ready).phase).toBe("loading")
  })

  test("counts elapsed seconds from the start of the load", () => {
    const loading = run([{ type: "load", revision: "rev_1", at: 1000 }])
    expect(logic.elapsed(loading, 13_900)).toBe(12)
    expect(logic.elapsed(loading, 0)).toBe(0)
  })

  test("survives serialization into the review page", () => {
    const serialized = (new Function(`return (${previewLoading.toString()})`)() as typeof previewLoading)()
    const state = [
      { type: "load", revision: "rev_1", at: 0 },
      { type: "document", revision: "rev_1" },
      { type: "ready" },
    ].reduce((current, event) => serialized.reduce(current, event as LoadingEvent), serialized.initial(0))
    expect(state.phase).toBe("ready")
  })
})

describe("design app waiting page", () => {
  test("shows a download's progress and reloads itself", () => {
    const html = designWaiting(reviewCopy, {
      phase: "download",
      version: "0.1.0",
      amount: "45%",
      percent: 45,
      elapsed: 12,
    })
    expect(html).toContain("Downloading redcode-design 0.1.0… 45%")
    expect(html).toContain('<progress max="100" value="45"')
    expect(html).toContain('http-equiv="refresh"')
    expect(html).toContain("12 s")
  })

  test("a failure shows why with Retry and stops reloading", () => {
    const html = designWaiting(reviewCopy, { phase: "failed", message: "Could not download <archive>" })
    expect(html).toContain(reviewCopy.appFailed)
    expect(html).toContain("Could not download &lt;archive&gt;")
    expect(html).toContain(reviewCopy.previewRetry)
    expect(html).not.toContain('http-equiv="refresh"')
  })

  test("starting the app says so without a size", () => {
    const html = designWaiting(reviewCopy, { phase: "start" })
    expect(html).toContain(reviewCopy.appStarting)
    expect(html).toContain("<progress aria-label=")
  })
})
