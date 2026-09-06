import { describe, expect, test } from "bun:test"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "path"
import { DesignWhiteboard as W } from "@/design/whiteboard"

// Ported from lavish-axi's mermaid-source and whiteboard-store tests, on our own layout: one
// prototype directory, its scenes beside the review's state.

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const scratch = () => fs.mkdtemp(path.join(os.tmpdir(), "redcode-whiteboard-"))

describe("the channel", () => {
  test("tokens are signed, bound to one prototype, and short lived", () => {
    const secret = Buffer.from("whiteboard-test-secret")
    const now = 1_700_000_000_000
    const token = W.mintChannel(secret, "proto_1", now)
    expect(W.verifyChannel(token, secret, "proto_1", now)).toBe(true)
    expect(W.verifyChannel(token + "x", secret, "proto_1", now)).toBe(false)
    expect(W.verifyChannel(token, secret, "proto_1", now + W.CHANNEL_TTL_MS + 1)).toBe(false)
    expect(W.verifyChannel(token, secret, "proto_2", now)).toBe(false)
    expect(W.verifyChannel(W.mintChannel(secret, "", now), secret, "", now)).toBe(false)
    expect(W.verifyChannel("forged", secret, "proto_1", now)).toBe(false)
  })
})

describe("the sources", () => {
  test("finds diagrams in document order, by class or by attribute", () => {
    const html = `<html><body>
    <pre class="mermaid">flowchart TD
  A --> B</pre>
    <p>prose</p>
    <div data-redcode-mermaid>sequenceDiagram
  A->>B: hi</div>
    <div data-lavish-mermaid>pie
  "a": 1</div>
  </body></html>`
    const sources = W.extractSources(html)
    expect(sources.map((s) => s.index)).toEqual([0, 1, 2])
    expect(sources[0]!.source).toBe("flowchart TD\n  A --> B")
    expect(sources[1]!.source).toBe("sequenceDiagram\n  A->>B: hi")
    expect(sources[2]!.source).toBe('pie\n  "a": 1')
  })

  test("decodes entities the way the browser does, and keeps label breaks", () => {
    expect(W.extractSources(`<pre class="mermaid">flowchart LR
  A --&gt; B{&quot;ok?&quot;}
  B --&gt; C[&amp;done&#39;]</pre>`)[0]!.source).toBe(`flowchart LR\n  A --> B{"ok?"}\n  B --> C[&done']`)
    expect(W.extractSources(`<div class="mermaid">graph TD; A --&amp;gt; B</div>`)[0]!.source).toBe("graph TD; A --&gt; B")
    expect(W.extractSources(`<div class="mermaid">flowchart TD\n  A["OBJECTIVE:<br/>do the thing"]</div>`)[0]!.source).toBe(
      `flowchart TD\n  A["OBJECTIVE:<br/>do the thing"]`,
    )
    expect(W.extractSources(`<div class="mermaid">graph TD; A-->B<span></span></div>`)[0]!.source).toBe("graph TD; A-->B")
  })

  test("requires the exact class token and follows attribute casing and quoting", () => {
    const sources = W.extractSources(`
    <div class="mermaid-like">graph TD; X-->Y</div>
    <div class="not mermaid diagram">graph TD; A-->B</div>
    <div class="mermaidish">graph TD; P-->Q</div>
    <div class=mermaid>graph TD; A-->B</div>
    <div CLASS="diagram mermaid">graph TD; B-->C</div>
    <div class='mermaid x'>graph TD; C-->D</div>`)
    expect(sources.map((s) => s.source)).toEqual([
      "graph TD; A-->B",
      "graph TD; A-->B",
      "graph TD; B-->C",
      "graph TD; C-->D",
    ])
    expect(W.extractSources("")).toEqual([])
    expect(W.extractSources(null)).toEqual([])
  })

  test("ignores comments, raw text and inert markup, so indexes match the browser", () => {
    const html = `<!-- <div class="mermaid">graph TD; HIDDEN-->X</div> -->
    <script>const example = '<div class="mermaid">graph TD; SCRIPT-->X</div>';</script>
    <template><div class="mermaid">graph TD; TEMPLATE-->X</div></template>
    <noscript><div class="mermaid">graph TD; NOSCRIPT-->X</div></noscript>
    <style>.example::after { content: '<div class="mermaid">'; }</style>
    <div class="mermaid">graph TD; A-->B</div>`
    expect(W.extractSources(html)).toEqual([{ index: 0, source: "graph TD; A-->B" }])
  })

  test("normalizes edges and hashes content", () => {
    expect(W.normalizeSource("\n  flowchart TD\n    A --> B\n  ")).toBe("  flowchart TD\n    A --> B")
    expect(W.normalizeSource("")).toBe("")
    const a = W.sourceHash("flowchart TD\n  A --> B")
    expect(a).toBe(W.sourceHash("\nflowchart TD\n  A --> B   \n"))
    expect(a).not.toBe(W.sourceHash("flowchart TD\n  A --> C"))
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(W.decodeHtmlEntities("A&#39;s &#x2192; B")).toBe("A's → B")
    expect(W.decodeHtmlEntities("a &amp;&amp; b")).toBe("a && b")
  })
})

describe("the scenes", () => {
  test("round-trip beside the review's state, with theme and background stripped", async () => {
    const root = await scratch()
    const scene = {
      elements: [{ id: "A", type: "rectangle" }],
      appState: { theme: "dark", viewBackgroundColor: "#121212", scrollX: 12 },
      files: {},
    }
    const baseline = { elements: [{ id: "A", type: "rectangle" }] }
    await W.save(root, 0, { sourceHash: "hash-1", textMetricsVersion: 1, scene, baseline })
    const loaded = (await W.load(root, 0))!
    expect(loaded.source_hash).toBe("hash-1")
    expect(loaded.text_metrics_version).toBe(1)
    expect(loaded.scene).toEqual({ ...scene, appState: { scrollX: 12 } })
    expect(loaded.baseline).toEqual(baseline)
    expect(loaded.updated_at).toBeTruthy()
    expect(W.dir(root)).toBe(path.join(root, ".review", "whiteboards"))
    expect(await W.load(root, 3)).toBeNull()
  })

  test("a later save wins, even when an earlier large one is still being written", async () => {
    const root = await scratch()
    await W.save(root, 1, { sourceHash: "h1", scene: { elements: [] }, baseline: null })
    await W.save(root, 1, { sourceHash: "h2", scene: { elements: [{ id: "B" }] }, baseline: null })
    expect((await W.load(root, 1))!.source_hash).toBe("h2")
    const slow = { elements: [{ id: "old", text: "x".repeat(8 * 1024 * 1024) }] }
    const latest = { elements: [{ id: "latest" }] }
    await Promise.all([
      W.save(root, 5, { sourceHash: "old", scene: slow, baseline: null }),
      W.save(root, 5, { sourceHash: "latest", scene: latest, baseline: null }),
    ])
    const loaded = (await W.load(root, 5))!
    expect(loaded.source_hash).toBe("latest")
    expect(loaded.scene).toEqual(latest)
  })

  test("refuses an index that is not a diagram's", async () => {
    const root = await scratch()
    expect(W.isValidIndex(0)).toBe(true)
    expect(W.isValidIndex("12")).toBe(true)
    expect(W.isValidIndex(1000)).toBe(false)
    expect(W.isValidIndex(-1)).toBe(false)
    expect(W.isValidIndex(1.5)).toBe(false)
    expect(() => W.save(root, -1 as never, { sourceHash: "", scene: null })).toThrow(/invalid/)
    await expect(W.load(root, "../7" as never)).rejects.toThrow(/invalid/)
    expect(() => W.writeFeedbackFiles(root, 1000, { scene: null })).toThrow(/invalid/)
  })

  test("writes the agent's files: a standalone scene and a PNG, or no PNG when the preview is not one", async () => {
    const root = await scratch()
    const written = await W.writeFeedbackFiles(root, 2, {
      scene: { elements: [{ id: "A", type: "rectangle" }], appState: { theme: "light" }, files: {} },
      pngDataUrl: PNG,
    })
    expect(written).toEqual(W.feedbackPaths(root, 2))
    const scene = JSON.parse(await fs.readFile(written.scenePath, "utf8"))
    expect(scene.type).toBe("excalidraw")
    expect(scene.version).toBe(2)
    expect(scene.source).toBe("redcode")
    expect(scene.elements[0].id).toBe("A")
    expect(scene.appState).toEqual({})
    const png = await fs.readFile(written.previewPath)
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])

    const noPreview = await W.writeFeedbackFiles(root, 4, {
      scene: { elements: [] },
      pngDataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    })
    expect(noPreview.scenePath.endsWith("4.excalidraw")).toBe(true)
    expect(noPreview.previewPath).toBe("")
    expect(W.decodePng(PNG)).toBeInstanceOf(Buffer)
    expect(W.decodePng("data:image/jpeg;base64,abcd")).toBeNull()
    expect(W.decodePng(null)).toBeNull()
  })
})

describe("the frame and the bundle", () => {
  test("the frame page loads only the vendored bundle and carries its token", () => {
    const html = W.frameHTML("channel-token</script>")
    expect(html).toContain('<link rel="stylesheet" href="/design/vendor/whiteboard/whiteboard.css">')
    expect(html).toContain('<script src="/design/vendor/whiteboard/whiteboard.js"></script>')
    expect(html).toContain('__redcodeWhiteboardChannelToken="channel-token\\u003c/script>"')
    expect(html).not.toMatch(/https?:\/\//)
    const csp = W.frameCSP("http://127.0.0.1:4096/design/vendor/whiteboard/")
    expect(csp).toContain("connect-src http://127.0.0.1:4096/design/vendor/whiteboard/")
    expect(csp).toContain("default-src 'none'")
  })

  test("bundle assets resolve only inside the bundle, by real path", async () => {
    const bundle = await scratch()
    await fs.mkdir(path.join(bundle, "fonts", "Excalifont"), { recursive: true })
    await fs.writeFile(path.join(bundle, "whiteboard.js"), "// bundle")
    await fs.writeFile(path.join(bundle, "fonts", "Excalifont", "Excalifont-Regular.woff2"), "font")
    const outside = await scratch()
    await fs.writeFile(path.join(outside, "secret.js"), "no")
    await fs.symlink(path.join(outside, "secret.js"), path.join(bundle, "link.js"))
    expect(await W.resolveAsset(bundle, "whiteboard.js")).toBe(await fs.realpath(path.join(bundle, "whiteboard.js")))
    expect(await W.resolveAsset(bundle, "fonts/Excalifont/Excalifont-Regular.woff2")).toBeTruthy()
    expect(await W.resolveAsset(bundle, "..%2F..%2Fstate.json")).toBeUndefined()
    expect(await W.resolveAsset(bundle, "nope.js")).toBeUndefined()
    expect(await W.resolveAsset(bundle, "link.js")).toBeUndefined()
    expect(await W.resolveAsset(bundle, "")).toBeUndefined()
    expect(W.assetMime("a.woff2")).toBe("font/woff2")
  })

  test("a source build has no release to fetch, and says so", async () => {
    expect(await W.download("local")).toBe("no-release")
    expect(W.releaseURL("1.2.3")).toBe(
      "https://github.com/reddb-io/redcode/releases/download/v1.2.3/redcode-whiteboard-1.2.3.tar.gz",
    )
    expect(W.bundleDir("1.2.3").endsWith(path.join("designs", "whiteboard", "1.2.3"))).toBe(true)
  })
})
