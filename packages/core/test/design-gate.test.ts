import { describe, expect, test } from "bun:test"
import { Design } from "@opencode/schema/design"
import { DesignGate } from "@opencode/core/design/gate"

const designID = Design.ID.make("design_checkout")

const audit = (revision: string, widths: number[], status: Design.Job["status"] = "completed"): Design.Job => ({
  id: `job_${revision}_${widths.join("_")}`,
  designID,
  input: { revision, format: "audit" },
  status,
  progress: status === "completed" ? 1 : 0,
  result: null,
  error: null,
  created: 1,
  audit: { revision, findings: [], scenarios: [], widths },
})

describe("DesignGate.classOf", () => {
  test("buckets widths the way the layout audit reports them", () => {
    expect(DesignGate.classOf(390)).toBe("mobile")
    expect(DesignGate.classOf(640)).toBe("mobile")
    expect(DesignGate.classOf(820)).toBe("compact")
    expect(DesignGate.classOf(1024)).toBe("compact")
    expect(DesignGate.classOf(1440)).toBe("desktop")
  })
})

describe("DesignGate.classes", () => {
  test("the configured set falls back to every class", () => {
    expect(DesignGate.classes(undefined)).toEqual(["mobile", "compact", "desktop"])
    expect(DesignGate.classes(["desktop", " Mobile "])).toEqual(["mobile", "desktop"])
    expect(DesignGate.classes(["nonsense"])).toEqual(["mobile", "compact", "desktop"])
  })
})

describe("DesignGate.viewports", () => {
  test("narrows the target's viewports to the configured classes", () => {
    const web = { target: "web" as const }
    expect(DesignGate.viewports(web, undefined, undefined).map((viewport) => viewport.width)).toEqual([390, 768, 1440])
    expect(DesignGate.viewports(web, undefined, ["mobile", "desktop"]).map((viewport) => viewport.width)).toEqual([
      390, 1440,
    ])
    expect(
      DesignGate.viewports(web, { breakpoints: [360, 1280, 1920] }, ["desktop"]).map((viewport) => viewport.width),
    ).toEqual([1280, 1920])
  })

  test("a narrowing that leaves the target nothing keeps every viewport", () => {
    expect(DesignGate.viewports({ target: "app" }, undefined, ["desktop"]).map((viewport) => viewport.width)).toEqual([
      393, 412,
    ])
    expect(
      DesignGate.viewports({ target: "presentation" }, undefined, ["mobile"]).map((viewport) => viewport.width),
    ).toEqual([1920])
  })
})

describe("DesignGate.check", () => {
  const web = { revision: "rev_2", target: "web" as const }

  test("needs a published revision", () => {
    expect(DesignGate.check({ ...web, revision: null }, [], undefined, undefined)).toContain("Publish a revision")
  })

  test("passes once completed audits of the published revision cover every class", () => {
    expect(DesignGate.check(web, [audit("rev_2", [390, 768, 1440])], undefined, undefined)).toBeUndefined()
    // Coverage may come from several audits of the same revision.
    expect(
      DesignGate.check(web, [audit("rev_2", [390]), audit("rev_2", [768, 1440])], undefined, undefined),
    ).toBeUndefined()
  })

  test("names the classes and widths still missing and how to audit them", () => {
    const refusal = DesignGate.check(web, [audit("rev_2", [390])], undefined, undefined)
    expect(refusal).toBe(
      'Revision rev_2 has no completed layout audit at compact (768px), desktop (1440px). Run design_export {"revision":"rev_2","format":"audit"}, wait for its native monitor to complete, then approve.',
    )
  })

  test("an audit of another revision, or one that did not complete, never counts", () => {
    expect(DesignGate.check(web, [audit("rev_1", [390, 768, 1440])], undefined, undefined)).toContain("rev_2")
    expect(DesignGate.check(web, [audit("rev_2", [390, 768, 1440], "failed")], undefined, undefined)).toContain(
      "mobile (390px)",
    )
  })

  test("only the configured classes are required", () => {
    expect(DesignGate.check(web, [audit("rev_2", [390])], undefined, ["mobile"])).toBeUndefined()
    expect(DesignGate.check(web, [audit("rev_2", [390])], undefined, ["mobile", "desktop"])).toContain(
      "desktop (1440px)",
    )
  })

  test("an app design is covered by one audit of its phones", () => {
    const app = { revision: "rev_2", target: "app" as const }
    expect(DesignGate.check(app, [audit("rev_2", [393, 412])], undefined, undefined)).toBeUndefined()
    expect(DesignGate.check(app, [], undefined, undefined)).toContain("mobile (393px, 412px)")
  })
})
