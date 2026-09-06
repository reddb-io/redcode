import { describe, expect, test } from "bun:test"
import { DesignLint } from "@/design/lint"

const ids = (html: string) => DesignLint.lint(html).map((f) => f.id)

describe("design lint", () => {
  test("a plain page passes", () => {
    expect(
      ids(`<style>:root{--accent:#b0413e}.card{border:1px solid #ddd;border-radius:4px}</style><h1>Settings</h1>`),
    ).toEqual([])
  })

  test("purple gradient, by hex and by keyword", () => {
    expect(ids(`<div style="background:linear-gradient(90deg,#6366f1,#a855f7)">`)).toEqual(["purple-gradient"])
    expect(ids(`<div style="background:linear-gradient(to right, purple, white)">`)).toEqual(["purple-gradient"])
  })

  test("blue→cyan trust gradient, only when both ends are present", () => {
    expect(ids(`<div style="background:linear-gradient(90deg,#3b82f6,#06b6d4)">`)).toEqual(["trust-gradient"])
    expect(ids(`<div style="background:linear-gradient(90deg,#3b82f6,#1e3a8a)">`)).toEqual([])
  })

  test("default indigo as a solid, unless the design system declares it", () => {
    expect(ids(`<style>.btn{background:#6366f1}</style>`)).toEqual(["default-indigo"])
    expect(ids(`<style>:root{--accent:#6366f1}.btn{background:var(--accent)}</style>`)).toEqual([])
    // laundered through another token name still counts
    expect(ids(`<style>:root{--primary:#6366f1}.btn{background:var(--primary)}</style>`)).toEqual(["default-indigo"])
  })

  test("emoji only when it stands in for an icon", () => {
    expect(ids(`<li>🚀 Fast deploys</li>`)).toEqual(["emoji-icon"])
    expect(ids(`<p>She said the launch went 🚀 well.</p>`)).toEqual([])
  })

  test("the rounded left-accent card", () => {
    expect(ids(`<style>.tip{border-left:4px solid #b0413e;border-radius:8px}</style>`)).toEqual(["left-accent-card"])
    expect(ids(`<style>.tip{border-left:4px solid #b0413e;border-radius:0}</style>`)).toEqual([])
  })

  test("invented metrics and filler copy", () => {
    expect(ids(`<p>10× faster than before</p>`)).toEqual(["invented-metric"])
    expect(ids(`<p>Lorem ipsum dolor</p>`)).toEqual(["filler-copy"])
  })

  test("scrollIntoView", () => {
    expect(ids(`<script>el.scrollIntoView()</script>`)).toEqual(["scroll-into-view"])
  })

  test("examples inside HTML comments do not fire", () => {
    expect(ids(`<!-- e.g. linear-gradient(#6366f1, #a855f7) --><h1>Hi</h1>`)).toEqual([])
  })

  test("the report reads as one note per finding, or nothing", () => {
    expect(DesignLint.report([])).toBeUndefined()
    const text = DesignLint.report(DesignLint.lint(`<p>Lorem ipsum</p>`))
    expect(text).toContain("Craft notes (1)")
    expect(text).toContain("- filler-copy:")
  })
})

describe("design lint, the second set", () => {
  test("uppercase without tracking, in a rule or inline; tracked or tokenised passes", () => {
    expect(ids(`<style>.eyebrow{text-transform:uppercase}</style>`)).toEqual(["caps-no-tracking"])
    expect(ids(`<span style="text-transform: uppercase; font-size: 12px">x</span>`)).toEqual(["caps-no-tracking"])
    expect(ids(`<style>.eyebrow{text-transform:uppercase;letter-spacing:.08em}</style>`)).toEqual([])
    expect(ids(`<style>.eyebrow{text-transform:uppercase;letter-spacing:var(--tracking)}</style>`)).toEqual([])
    expect(ids(`<style>.eyebrow{text-transform:uppercase;letter-spacing:0.02em}</style>`)).toEqual(["caps-no-tracking"])
  })

  test("any remote image, since the prototype has no network", () => {
    expect(ids(`<img src="https://images.unsplash.com/x.jpg">`)).toEqual(["external-image"])
    expect(ids(`<img src="//cdn.example.com/x.png">`)).toEqual(["external-image"])
    expect(ids(`<img src="./hero.png"><img src="data:image/png;base64,AAAA">`)).toEqual([])
  })

  test("raw hex outside :root, beyond a dozen", () => {
    const many = Array.from({ length: 13 }, (_, i) => `.c${i}{color:#${(i + 1).toString(16).padStart(6, "0")}}`).join(
      "",
    )
    expect(ids(`<style>${many}</style>`)).toEqual(["raw-hex"])
    const tokens = Array.from({ length: 13 }, (_, i) => `--c${i}:#${(i + 1).toString(16).padStart(6, "0")};`).join("")
    expect(ids(`<style>:root{${tokens}}</style>`)).toEqual([])
  })

  test("the accent everywhere", () => {
    const seven = Array.from({ length: 7 }, () => `<b style="color:var(--accent)">x</b>`).join("")
    expect(ids(seven)).toEqual(["accent-overuse"])
    expect(ids(`<b style="color:var(--accent)">x</b><i style="color:var(--accent)">y</i>`)).toEqual([])
  })
})

describe("whether the page paints itself", () => {
  const page = (bodyAttrs: string, head = "", body = "<p>Report text</p>") =>
    `<!doctype html><html><head>${head}</head><body${bodyAttrs ? ` ${bodyAttrs}` : ""}>${body}</body></html>`
  const paint = DesignLint.analyzeSelfPaint

  test("no styling, element colours only, a wrapper background, or look-alike selectors are unpainted", () => {
    expect(paint(page("")).painted).toBe(false)
    expect(paint(page("", "<style>h1 { color: #f8fafc } p { color: #e2e8f0 }</style>")).painted).toBe(false)
    expect(paint(page("", "<style>.board { background: #0b1020 }</style>")).painted).toBe(false)
    expect(
      paint(page("", "<style>.body-card { background: #fff } #html-view { background: #000 }</style>")).painted,
    ).toBe(false)
  })

  test("a root background rule paints it, nested in a media query, minified or grouped as well", () => {
    expect(paint(page("", "<style>body { background: #0b1020; color: #e2e8f0 }</style>"))).toEqual({
      painted: true,
      signal: "root-background-rule",
    })
    expect(paint(page("", "<style>:root { background-color: #fff }</style>")).painted).toBe(true)
    expect(paint(page("", "<style>html { background: canvas }</style>")).painted).toBe(true)
    expect(paint(page("", "<style>* { background: #fff }</style>")).painted).toBe(true)
    expect(
      paint(page("", "<style>@media (prefers-color-scheme: dark) { body { background: #020617 } }</style>")).painted,
    ).toBe(true)
    expect(paint(page("", "<style>html,body{margin:0;background:#111;color:#eee}</style>")).painted).toBe(true)
    expect(paint(page("", "<style>body.dark{background:var(--bg)}</style>")).painted).toBe(true)
  })

  test("a theme attribute, a background class, an inline background, a stylesheet, or the Tailwind runtime paints it", () => {
    expect(paint(`<!doctype html><html data-theme="luxury"><body><p>x</p></body></html>`)).toEqual({
      painted: true,
      signal: "data-theme",
    })
    expect(paint(page(`class="bg-base-100 text-base-content"`)).signal).toBe("background-class")
    expect(paint(page(`class="min-h-screen dark:bg-slate-900"`)).painted).toBe(true)
    expect(paint(page(`style="background: #111"`)).signal).toBe("inline-background")
    expect(paint(page("", '<link rel="stylesheet" href="./app.css">')).signal).toBe("stylesheet-link")
    expect(paint(page("", '<script src="../../vendor/tailwind.js"></script>')).signal).toBe("tailwind-runtime")
    expect(paint(page("", '<meta name="color-scheme" content="dark light">')).signal).toBe("color-scheme")
    expect(paint(page("", "<style>@import url(theme.css);</style>")).signal).toBe("css-import")
  })
})
