import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { testEffect } from "../lib/effect"
import { DesignPlaybooks } from "@/design/playbooks"
import { DesignPlaybookTool } from "@/tool/design-playbook"
import PROMPT from "../../src/session/prompt/design-mode.txt"

describe("the playbooks", () => {
  test("are the seven lavish teaches, each complete, with ids stable enough to name in a prompt", () => {
    expect(DesignPlaybooks.ids()).toEqual(["diagram", "table", "comparison", "plan", "code", "input", "slides"])
    for (const item of DesignPlaybooks.PLAYBOOKS) {
      expect(item.use_when.length).toBeGreaterThan(10)
      for (const list of [item.choose, item.structure, item.design_rules, item.pitfalls, item.review_notes]) {
        expect(list.length).toBeGreaterThan(0)
      }
    }
  })

  test("are written for this review page, not lavish's", () => {
    const all = DesignPlaybooks.PLAYBOOKS.map(DesignPlaybooks.render).join("\n")
    expect(all).toContain("window.redcodeDesign.queuePrompt")
    expect(all).toContain("data-redcode-question")
    expect(all).toContain("../../vendor/mermaid.js")
    expect(all).not.toContain("window.lavish")
    expect(all).not.toContain("data-lavish")
    // No network in the prototype, so nothing points at a CDN.
    expect(all).not.toContain("esm.sh")
    expect(all).not.toContain("cdn.")
  })

  test("the list says when each applies, and one renders as sections a model reads", () => {
    const list = DesignPlaybooks.list()
    expect(list).toContain(DesignPlaybooks.ROUTER)
    expect(list).toContain("- input:")
    const one = DesignPlaybooks.render(DesignPlaybooks.find("table")!)
    expect(one.startsWith("# Playbook: table")).toBe(true)
    for (const section of ["## Choose", "## Structure", "## Design rules", "## Pitfalls", "## In the review"]) {
      expect(one).toContain(section)
    }
    expect(DesignPlaybooks.find(" Table ")).toBe(DesignPlaybooks.find("table"))
    expect(DesignPlaybooks.find("nope")).toBeUndefined()
  })

  test("the prompt routes to them before any HTML is written", () => {
    expect(PROMPT).toContain("design_playbook")
    expect(PROMPT).toContain("before writing HTML")
  })
})

describe("design_playbook, the tool", () => {
  const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))
  const run = (params: { id?: string }) =>
    Effect.gen(function* () {
      const tool = yield* (yield* DesignPlaybookTool).init()
      return yield* tool.execute(params, {} as never)
    })

  it.instance("lists with no id, hands one over by id, and names the known ones on a miss", () =>
    Effect.gen(function* () {
      const listed = yield* run({})
      expect(listed.output).toContain("- diagram:")
      expect(listed.metadata.ids).toHaveLength(7)
      const one = yield* run({ id: "input" })
      expect(one.title).toBe("Playbook: input")
      expect(one.output).toContain("exactly once")
      const miss = yield* run({ id: "poster" }).pipe(Effect.exit)
      expect(Exit.isFailure(miss)).toBe(true)
      expect(String(Exit.isFailure(miss) ? Cause.squash(miss.cause) : "")).toContain("Known: diagram, table")
    }),
  )
})
