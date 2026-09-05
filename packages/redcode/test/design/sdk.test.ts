import { describe, expect, test } from "bun:test"
import { injectSDK, sdkScript } from "@/design/sdk"

describe("what the prototype is given", () => {
  test("goes into the document without disturbing what the model wrote", () => {
    const page = "<!doctype html><html><head><title>t</title></head><body><h1>hi</h1></body></html>"
    const out = injectSDK(page)
    expect(out).toContain("<title>t</title>")
    expect(out).toContain("<h1>hi</h1>")
    // Right after <head>, so it is in place before the prototype's own scripts run.
    expect(out.indexOf("redcode-design")).toBeLessThan(out.indexOf("<title>"))
  })

  test("copes with the documents a model actually writes", () => {
    expect(injectSDK("<body><p>no head</p></body>")).toContain("redcode-design")
    expect(injectSDK("<h1>fragment</h1>")).toContain("redcode-design")
    expect(injectSDK('<html><HEAD lang="x"><meta></HEAD></html>')).toContain("redcode-design")
  })

  test("is inert twice, because a reload should not stack two of them", () => {
    expect(sdkScript()).toContain("if (window.__redcodeDesign) return")
  })

  test("proposes and cannot do anything else", () => {
    const script = sdkScript()
    // Its whole vocabulary, matching the shell's allowlist.
    expect(script).toContain('post("annotate"')
    expect(script).toContain('post("ready"')
    // No way to reach anything: the serving policy forbids it, and the code does not try.
    expect(script).not.toContain("fetch(")
    expect(script).not.toContain("XMLHttpRequest")
    expect(script).not.toContain("WebSocket")
  })

  test("leaves the prototype usable, which is the point of a prototype", () => {
    // Annotation is on alt-click, so ordinary clicks still drive the thing being reviewed.
    expect(sdkScript()).toContain("if (!event.altKey) return")
  })

  test("cannot be deformed by the prototype's own CSS", () => {
    expect(sdkScript()).toContain('attachShadow({ mode: "closed" })')
    expect(sdkScript()).toContain(":host { all: initial }")
  })
})
