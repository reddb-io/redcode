import { describe, expect, test } from "bun:test"
import { injectSDK, sdkScript } from "@/design/sdk"

describe("what the prototype is given", () => {
  test("goes into the document without disturbing what the model wrote", () => {
    const page = "<!doctype html><html><head><title>t</title></head><body><h1>hi</h1></body></html>"
    const out = injectSDK(page, { load: 2 })
    expect(out).toContain("<title>t</title>")
    expect(out).toContain("<h1>hi</h1>")
    // Right after <head>, so it is in place before the prototype's own scripts run.
    expect(out.indexOf("redcode-design")).toBeLessThan(out.indexOf("<title>"))
    // Exactly one tag: the served document is otherwise the file on disk.
    expect(out.split("<script").length - 1).toBe(1)
  })

  test("copes with the documents a model actually writes", () => {
    expect(injectSDK("<body><p>no head</p></body>")).toContain("redcode-design")
    expect(injectSDK("<h1>fragment</h1>")).toContain("redcode-design")
    expect(injectSDK('<html><HEAD lang="x"><meta></HEAD></html>')).toContain("redcode-design")
  })

  test("is one valid script, carrying the revision it was served for", () => {
    const script = sdkScript({ load: 7 })
    expect(() => new Function(script)).not.toThrow()
    expect(script).toContain('{"load":7}')
    // The helpers are declared by name and handed to the main function as a table.
    expect(script).toContain("function deriveQueueKey(")
    expect(script).toContain("function tableCellTarget(")
    expect(script).toContain("deriveQueueKey: deriveQueueKey")
  })

  test("is inert twice, because a reload should not stack two of them", () => {
    expect(sdkScript()).toMatch(/if \(win\.__redcodeDesign\)\s*return/)
  })

  test("proposes and cannot do anything else", () => {
    const script = sdkScript()
    // Its whole vocabulary goes through one postMessage helper, stamped with the revision.
    expect(script).toContain('source: "redcode-design"')
    expect(script).toContain('post("queuePrompt"')
    expect(script).toContain('post("ready"')
    // No way to reach anything: the serving policy forbids it, and the code does not try.
    expect(script).not.toContain("fetch(")
    expect(script).not.toContain("XMLHttpRequest")
    expect(script).not.toContain("WebSocket")
  })

  test("leaves the prototype usable, which is the point of a prototype", () => {
    const script = sdkScript()
    // Native controls keep working in annotate mode, and alt-click annotates in explore mode.
    expect(script).toContain("isNativeInteractiveControl(")
    expect(script).toContain("event.altKey")
    expect(script).toContain("toggleAnnotationMode")
  })

  test("speaks the review API an artifact written for lavish expects", () => {
    const script = sdkScript()
    expect(script).toContain("win.redcodeDesign = api")
    expect(script).toContain("win.lavish = api")
    expect(script).toContain("Context data:")
    expect(script).toContain("data-lavish-action")
  })

  test("cannot be deformed by the prototype's own CSS", () => {
    const script = sdkScript()
    expect(script).toMatch(/attachShadow\(\{\s*mode: "closed"\s*\}\)/)
    expect(script).toContain(":host{all:initial")
  })
})

describe("images on the card", () => {
  test("are captured by the card, uploaded by the shell, and applied only to the document that asked", () => {
    const script = sdkScript({ load: 1, attachments: { maxCount: 4, maxBytes: 1024, accepted: ["image/png"] } })
    expect(script).toContain('post("uploadAttachment"')
    expect(script).toContain('case "attachmentResult"')
    expect(script).toContain("isTrustedAttachmentResult(")
    expect(script).toContain("nonce: ATTACHMENT_NONCE")
    // The limits are the server's, threaded in, not a literal of the card's own.
    expect(script).toContain('"maxBytes":1024')
    // Queuing waits for every chip to settle; a drop over the card never navigates the frame.
    expect(script).toContain("attachments.hasPending() || attachments.hasErrors()")
    expect(script).toContain("partitionDroppedFiles(")
    expect(script).not.toContain("fetch(")
  })
})

describe("the layout audit inside the prototype", () => {
  test("is bundled beside the helpers, reports passes and fatal asset failures, and can be asked again", () => {
    const script = sdkScript({ load: 3 })
    expect(script).toContain("function artifactAudit(")
    expect(script).toContain("artifactAudit: artifactAudit")
    expect(script).toContain('post("layoutDiagnostics"')
    expect(script).toContain("artifact_pass_sequence")
    expect(script).toContain('post("artifactAssetFailure"')
    expect(script).toContain('case "requestLayoutDiagnostics"')
    // The six rules, each of which stays silent rather than guessing.
    for (const rule of [
      "page-horizontal-overflow",
      "clipped-text",
      "clipped-control",
      "viewport-unreachable-control",
      "viewport-unreachable-content",
      "overlapping-text",
    ])
      expect(script).toContain('"' + rule + '"')
    expect(script).not.toContain("fetch(")
    expect(() => new Function(script)).not.toThrow()
  })
})
