import { describe, expect, test } from "bun:test"
import { shellCSP, shellHTML } from "@/design/shell"

const html = shellHTML({ id: "p1", name: "hero", token: "tok_abc", revision: 3 })

describe("the review shell", () => {
  test("frames the prototype without giving it an origin", () => {
    // This is the security boundary: with allow-same-origin the framed document could read this
    // page's token and post prompts as the user.
    expect(html).toContain('sandbox="allow-scripts allow-forms allow-modals allow-popups"')
    expect(html).not.toContain("allow-same-origin")
  })

  test("only listens for what the prototype is allowed to say", () => {
    expect(html).toContain(
      'new Set(["ready","queuePrompt","sendQueuedPrompts","endSession","toggleAnnotationMode","snapshot","scroll","status","reviewState","reviewDraftUnrestorable","uploadAttachment","mode"])',
    )
    // And only for the document it is showing: a stale frame's messages are dropped.
    expect(html).toContain("if (data.load !== revision) return")
    // Identity of the sender, not just its origin: an opaque origin reports itself as "null".
    expect(html).toContain("event.source !== frame.contentWindow")
  })

  test("sending is a person's act, not the page's", () => {
    // The frame can propose; only a submit on our own chrome sends. The handler for what the
    // frame says never fetches on its own: it queues, or it calls the same submit the button does.
    expect(html).toContain('addEventListener("submit", submit)')
    const handler = html.slice(
      html.indexOf('window.addEventListener("message"'),
      html.indexOf("// The frame reported the state"),
    )
    expect(handler).not.toContain("fetch(")
    expect(handler).toContain('case "queuePrompt": enqueue(payload.prompt)')
  })

  test("listens to the server for reloads, replies, presence and the end, and reconnects on its own", () => {
    expect(html).toContain('new EventSource(base + "/events?token="')
    for (const type of ["reload", "chat-sync", "agent-reply", "presence", "ended"])
      expect(html).toContain('on("' + type + '"')
    expect(html).toContain("backoff = Math.min(backoff * 2, 5000)")
    expect(html).not.toContain("setInterval(")
  })

  test("ending is the person's act, and an ended review opens read-only", () => {
    expect(html).toContain('fetch(base + "/end"')
    expect(html).toContain('id="sendEnd"')
    const closed = shellHTML({ id: "p1", name: "n", token: "t", revision: 1, ended: "agent" })
    expect(closed).toContain("<body data-ended>")
    expect(closed).toContain('"ended":"agent"')
  })

  test("folds into a sheet on a phone", () => {
    expect(html).toContain("@media (max-width: 860px)")
    expect(html).toContain('id="panelHead"')
    expect(html).toContain("SHEET_DRAG_THRESHOLD_PX".length ? "offset > 48" : "")
    expect(html).toContain("--vv-height")
  })

  test("carries the prototype's identity without letting content forge the page", () => {
    expect(html).toContain('"token":"tok_abc"')
    const injected = shellHTML({ id: "p1", name: "</title><script>alert(1)</script>", token: "t", revision: 1 })
    expect(injected).not.toContain("<script>alert(1)</script>")
    expect(injected).toContain("&lt;script&gt;")
    // The name is also inside the config JSON, where a "</script>" would end the block early.
    expect(injected).not.toContain("alert(1)</script>")
    expect(injected).toContain("alert(1)\\u003c/script>")
  })

  test("its own policy is strict, because it is the trusted half", () => {
    const csp = shellCSP()
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-src 'self'")
    expect(csp).toContain("form-action 'none'")
  })
})

describe("embedded in the app", () => {
  test("drops its own header and keeps the composer", () => {
    const html = shellHTML({ id: "abc", name: "n", token: "t", revision: 1, embed: true })
    expect(html).toContain("<body data-embed>")
    expect(html).toContain('id="composer"')
    expect(shellHTML({ id: "abc", name: "n", token: "t", revision: 1 })).toContain("<body>")
  })
})

describe("notes, held and illustrated", () => {
  test("holding keeps the note on the page; only Send leaves it", () => {
    expect(html).toContain('id="hold"')
    expect(html).toContain('hold.addEventListener("click"')
    // The hold handler queues and redraws; it never fetches.
    const hold = html.slice(html.indexOf('hold.addEventListener("click"'), html.indexOf("// --- the sheet, on a phone"))
    expect(hold).not.toContain("fetch(")
  })

  test("an image is uploaded by the shell for both surfaces, within budgets, and rides on the note as an id", () => {
    // The composer has chips; the frame captures bytes and asks this page to upload them.
    expect(html).toContain('id="attachInput"')
    expect(html).toContain('case "uploadAttachment"')
    expect(html).toContain('tell("attachmentResult", { nonce: payload.nonce, localId, ...result })')
    expect(html).toContain('fetch(base + "/attachments"')
    // Bounded before the network: a rate, a lifetime quota, an in-flight ceiling.
    expect(html).toContain("uploadTimestamps.length >= 30")
    expect(html).toContain("uploadsInFlight >= 4")
    expect(html).toContain("256 * 1024 * 1024".length ? "268435456" : "")
    // Nothing is inlined any more: no base64 downscaling, and the note carries ids the server re-derives.
    expect(html).not.toContain("MAX_EDGE")
    expect(html).not.toContain("toDataURL")
    expect(html).toContain("attachments: ready")
    // A refused batch keeps the queue and says which cap was hit.
    expect(html).toContain("detail.error")
  })
})

describe("annotate or explore", () => {
  test("the shell owns the mode and tells the frame, on the button and on the hotkey", () => {
    expect(html).toContain('id="mode"')
    expect(html).toContain('tell("setAnnotationMode", { annotate })')
    expect(html).toContain('String(event.key || "").toLowerCase() !== "i"')
  })

  test("a queued prompt that names the same control replaces the unsent one", () => {
    expect(html).toContain("pending.findIndex((x) => x.queueKey === item.queueKey)")
  })

  test("a send carries the page's snapshot and can end the review", () => {
    expect(html).toContain('tell("requestSnapshot"')
    expect(html).toContain("...(dom ? { snapshot: dom } : {})")
    expect(html).toContain("...(end ? { end: true } : {})")
  })

  test("what the frame reported is replayed after it reloads, and kept across a reload of this page", () => {
    expect(html).toContain('if (scrollPos) tell("restoreScroll", scrollPos)')
    expect(html).toContain('if (reviewState) tell("restoreReviewState", { state: reviewState })')
    expect(html).toContain('"redcode-design:" + name + ":" + config.id')
    expect(html).toContain('save("queued", pending.length ? pending : null)')
  })

  test("a draft is retired only when a second revision still lacks its anchor, and the text is handed back", () => {
    expect(html).toContain("if (unrestorableMiss.revision === revision) return")
    expect(html).toContain('el.className = "bubble note"')
  })
})

describe("the shell's own script", () => {
  test("is valid JavaScript, whatever the prototype is called", () => {
    for (const name of ["hero", "</script><script>alert(1)</script>", 'a "quoted" name', "line\nbreak"]) {
      const page = shellHTML({ id: "p1", name, token: "t", revision: 1, root: "/w/x" })
      const script = page.slice(page.lastIndexOf("<script>") + 8, page.lastIndexOf("</script>"))
      expect(() => new Function(script)).not.toThrow()
    }
  })
})
