import { describe, expect, test } from "bun:test"
import { DesignState } from "@/design/state"

describe("what a review remembers", () => {
  test("survives a round trip, chat and all", () => {
    const state: DesignState.Persisted = {
      id: "abc",
      sessionID: "ses_1",
      root: "/w/.red/code/designs/hero",
      name: "hero",
      token: "tok",
      revision: 4,
      ended: { by: "user", at: 100 },
      chat: [
        { role: "user", text: "make it blue", at: 1 },
        { role: "agent", text: "done", at: 2 },
      ],
    }
    expect(DesignState.parse(DesignState.serialize(state))).toEqual(state)
  })

  test("keeps the layout inbox, and drops records without an identity", () => {
    const warning = {
      id: "abcd",
      fingerprint: "abcd",
      rule: "clipped-text",
      severity: "error",
      status: "open",
      selector: "p#copy",
      component: "#copy",
      axis: "vertical",
      overflow_px: 27,
      viewport_class: "mobile",
      viewport_width: 390,
      first_seen_at: "2026-07-30T00:00:00.000Z",
      first_seen_revision: 1,
      last_seen_at: "2026-07-30T00:00:00.000Z",
      last_seen_revision: 1,
      observation_count: 1,
      queued_revision: 0,
      queued_at: "",
      queue_attempts: 0,
      dismissed_revision: 0,
      history: [],
    }
    const parsed = DesignState.parse(
      JSON.stringify({ id: "abc", sessionID: "s", root: "/w/a", token: "t", revision: 2, chat: [], warnings: [warning, { rule: "x" }] }),
    )!
    expect(parsed.warnings).toEqual([warning as never])
    expect(DesignState.parse(DesignState.serialize(parsed))!.warnings).toEqual([warning as never])
  })

  test("a corrupt or foreign sidecar is nothing, not a crash", () => {
    expect(DesignState.parse("{")).toBeUndefined()
    expect(DesignState.parse("[]")).toBeUndefined()
    expect(DesignState.parse(JSON.stringify({ id: "x" }))).toBeUndefined()
  })

  test("keeps what it recognises and drops what it does not", () => {
    const parsed = DesignState.parse(
      JSON.stringify({
        id: "abc",
        sessionID: "ses_1",
        root: "/w/a",
        token: "t",
        revision: -3,
        ended: { by: "someone", at: "soon" },
        chat: [{ role: "agent", text: "" }, { role: "user", text: "hi" }, "junk", { role: "x", text: "y", at: 5 }],
        extra: true,
      }),
    )!
    expect(parsed.name).toBe("a")
    expect(parsed.revision).toBe(1)
    expect(parsed.ended).toEqual({ by: "user", at: 0 })
    expect(parsed.chat).toEqual([
      { role: "user", text: "hi", at: 0 },
      { role: "user", text: "y", at: 5 },
    ])
    expect("extra" in parsed).toBe(false)
  })

  test("the index keeps only well-formed ids", () => {
    const index = DesignState.parseIndex(
      JSON.stringify({
        ok: { root: "/w/a", sessionID: "ses_1" },
        "../evil": { root: "/w/b", sessionID: "ses_1" },
        broken: { root: "" },
        list: [],
      }),
    )
    expect(Object.keys(index)).toEqual(["ok"])
    expect(DesignState.parseIndex("nope")).toEqual({})
  })
})
