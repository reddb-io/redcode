import { describe, expect, test } from "bun:test"
import { HumanWait } from "../../src/session/human-wait"

describe("HumanWait", () => {
  test("a parent and a subagent reusing one provider call ID keep separate waits", () => {
    HumanWait.claim("ses_parent", "call_0")
    HumanWait.claim("ses_child", "call_0")
    const done = HumanWait.start("ses_child", "call_0", 1_000)

    expect(HumanWait.waited("ses_parent", "call_0", 5_000)).toBe(0)
    expect(HumanWait.waited("ses_child", "call_0", 5_000)).toBe(4_000)

    HumanWait.forget("ses_parent", "call_0")
    expect(HumanWait.waited("ses_child", "call_0", 6_000)).toBe(5_000)
    done(6_000)
    HumanWait.forget("ses_child", "call_0")
  })

  test("overlapping question and permission waits subtract wall time once", () => {
    HumanWait.claim("ses_overlap", "call_1")
    const question = HumanWait.start("ses_overlap", "call_1", 0)
    const permission = HumanWait.start("ses_overlap", "call_1", 2_000)
    permission(5_000)
    question(6_000)
    const later = HumanWait.start("ses_overlap", "call_1", 10_000)
    later(11_000)

    expect(HumanWait.waited("ses_overlap", "call_1", 20_000)).toBe(7_000)
    HumanWait.forget("ses_overlap", "call_1")
  })

  test("a wait outside a claimed tool call records nothing", () => {
    const done = HumanWait.start("ses_unclaimed", "call_2", 0)
    done(10_000)
    expect(HumanWait.waited("ses_unclaimed", "call_2", 20_000)).toBe(0)
  })
})
