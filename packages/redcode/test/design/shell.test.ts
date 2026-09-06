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
      'new Set(["ready","queuePrompt","sendQueuedPrompts","endSession","toggleAnnotationMode","snapshot","scroll","status","draft","mode"])',
    )
    // And only for the document it is showing: a stale frame's messages are dropped.
    expect(html).toContain("if (data.load !== revision) return")
    // Identity of the sender, not just its origin: an opaque origin reports itself as "null".
    expect(html).toContain("event.source !== frame.contentWindow")
  })

  test("sending is a person's act, not the page's", () => {
    // The frame can propose; only a submit on our own chrome sends.
    expect(html).toContain('addEventListener("submit", submit)')
    expect(html).not.toMatch(/message[\s\S]{0,400}fetch\(base \+ "\/feedback"/)
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
    const hold = html.slice(html.indexOf('hold.addEventListener("click"'), html.indexOf("const submit = async"))
    expect(hold).not.toContain("fetch(")
  })

  test("an image is captured by the shell, downscaled, and never asked of the prototype", () => {
    expect(html).toContain('addEventListener("paste"')
    expect(html).toContain('addEventListener("drop"')
    expect(html).toContain("MAX_EDGE = 1280")
    // The frame's vocabulary has no image in it: it cannot hand the shell one.
    expect(html).not.toContain('"image"')
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

  test("what the frame reported is replayed after it reloads", () => {
    expect(html).toContain('if (scroll) tell("restoreScroll", scroll)')
    expect(html).toContain('if (cardDraft) tell("restoreDraft", cardDraft)')
  })
})
