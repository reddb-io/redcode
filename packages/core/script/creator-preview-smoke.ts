/// <reference lib="dom" />

import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { chromium } from "playwright-core"
import { Schema } from "effect"
import { Design } from "@opencode/schema/design"
import { DesignBuild } from "@opencode/core/design/build"
import { DesignFiles } from "@opencode/core/design/files"
import { DesignPage } from "@opencode/core/design/ui/page"
import { tmpdir } from "../test/fixture/tmpdir"

// Same production build, serialized review and sandbox runtimes as Design; the fixture owns its server and browser.
await using temporary = await tmpdir("redcode-creator-scene-")
const output = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "redcode-creator-preview-proof"))
await mkdir(output, { recursive: true })
const root = path.join(temporary.path, "work")
await Bun.write(
  path.join(root, "index.html"),
  Bun.file(path.join(import.meta.dir, "../test/fixture/creator-scene.html")),
)
const design = Schema.decodeUnknownSync(Design.Info)({
  id: "design_creator_scene",
  sessionID: "ses_creator_scene",
  name: "Creator · Procedural scene",
  journey: "new",
  engine: "html",
  kind: "screen",
  target: "web",
  root,
  application: temporary.path,
  entry: "index.html",
  brief: {
    objective: "Review an interactive local 3D scene",
    audience: "Creators",
    content: "Procedural cube",
    constraints: "No network",
    references: [],
  },
  decisions: [],
  questions: [],
  scenarios: [],
  designSystem: "",
  sources: [],
  tweaks: {},
  revision: "rev_creator_scene",
  approvedRevision: null,
  ended: false,
  updated: 1,
})
const blobs = path.join(temporary.path, "blobs")
const revision = Schema.decodeUnknownSync(Design.Revision)({
  id: design.revision,
  designID: design.id,
  parent: null,
  name: "Procedural cube",
  created: 1,
  document: design,
  files: await DesignFiles.snapshot(root, blobs),
})
const built = await DesignBuild.build(revision, blobs, path.join(temporary.path, "build"))
const preview = await DesignPage.preview(revision, built)
const endpoint = `/api/session/${design.sessionID}/design`
const calls: string[] = []
using server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 60,
  fetch(request) {
    const route = new URL(request.url).pathname
    calls.push(route)
    if (route === "/")
      return new Response(DesignPage.review(design.sessionID, endpoint), {
        headers: { "content-type": "text/html", "content-security-policy": DesignPage.CSP },
      })
    if (route === endpoint) return Response.json([design])
    if (route.endsWith("/feed"))
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"))
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    if (route.endsWith("/revision")) return Response.json([revision])
    if (route.endsWith("/preview")) return new Response(preview, { headers: { "content-type": "text/html" } })
    if (route.endsWith("/status")) return Response.json({ stage: "ready" })
    if (route.endsWith("/todo") || route.endsWith("/asset") || route.endsWith("/job")) return Response.json([])
    return new Response("Unknown fixture route", { status: 404 })
  },
})
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors: string[] = []
  const external: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== server.url.origin) external.push(request.url())
  })
  await page.goto(server.url.toString())
  const frame = page.frameLocator("#preview")
  await frame.getByRole("status").filter({ hasText: "Ready" }).waitFor()
  const sandbox = await page.locator("#preview").getAttribute("sandbox")
  assert.ok(sandbox?.split(" ").includes("allow-scripts"))
  assert.ok(!sandbox?.split(" ").includes("allow-same-origin"))
  const pixels = () =>
    frame.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext("webgl")!
      const image = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, image)
      let colored = 0
      let red = 0
      let blue = 0
      for (let offset = 0; offset < image.length; offset += 4) {
        if (image[offset] + image[offset + 1] + image[offset + 2] < 150) continue
        colored++
        red += image[offset]
        blue += image[offset + 2]
      }
      return { colored, red, blue }
    })
  const initial = await pixels()
  assert.ok(initial.colored > 10_000, "WebGL must draw visible scene geometry")
  assert.ok(initial.blue > initial.red, "Initial material must be blue")
  await frame.getByRole("button", { name: "Rotate scene" }).click()
  await frame.getByRole("status").filter({ hasText: "2 frames" }).waitFor()
  await frame.getByRole("button", { name: "Warm clay" }).click()
  await frame.getByRole("status").filter({ hasText: "warm clay" }).waitFor()
  const changed = await pixels()
  assert.ok(changed.red > changed.blue, "Material control must change rendered pixels")
  assert.notEqual(changed.colored, initial.colored, "Rotation must change the projected geometry")
  const isolated = await frame.locator("canvas").evaluate(() => {
    try {
      return parent.document === undefined
    } catch {
      return true
    }
  })
  assert.equal(isolated, true, "The model-written scene must not access its parent document")
  const screenshot = path.join(output, "creator-scene.png")
  await page.screenshot({ path: screenshot, fullPage: true })
  await frame.getByRole("button", { name: "Release graphics" }).click()
  await frame.getByRole("status").filter({ hasText: "Graphics released" }).waitFor()
  await frame.locator("canvas").evaluate(
    (canvas: HTMLCanvasElement) =>
      new Promise<void>((resolve) => {
        if (canvas.getContext("webgl")!.isContextLost()) return resolve()
        canvas.addEventListener("webglcontextlost", () => resolve(), { once: true })
      }),
  )
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  assert.ok(calls.some((route) => route.endsWith("/preview")))
  const report = {
    pipeline: "DesignFiles.snapshot → DesignBuild.build → DesignPage.review/preview",
    screenshot,
    files: Object.keys(revision.files),
    sandbox,
    parentAccessBlocked: isolated,
    initial,
    changed,
    disposed: true,
    externalRequests: external,
    pageErrors: errors,
    gpu: "Chromium software WebGL (SwiftShader)",
    limitations: [
      "Fixture review server; not a persisted DesignStore/session admission test",
      "No Blender, Three.js, remote provider or 3D file exporter involved",
    ],
  }
  await Bun.write(path.join(output, "report.json"), JSON.stringify(report, null, 2))
  process.stdout.write(JSON.stringify(report, null, 2) + "\n")
} finally {
  await browser.close()
}
