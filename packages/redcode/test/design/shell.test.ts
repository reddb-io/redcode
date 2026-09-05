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
    expect(html).toContain('new Set(["ready", "annotate"])')
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
    const injected = shellHTML({ id: "p1", name: '</title><script>alert(1)</script>', token: "t", revision: 1 })
    expect(injected).not.toContain("<script>alert(1)</script>")
    expect(injected).toContain("&lt;script&gt;")
  })

  test("its own policy is strict, because it is the trusted half", () => {
    const csp = shellCSP()
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-src 'self'")
    expect(csp).toContain("form-action 'none'")
  })
})
