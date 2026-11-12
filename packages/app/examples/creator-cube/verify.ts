import assert from "node:assert/strict"
import path from "node:path"
import os from "node:os"
import { chromium, expect } from "@playwright/test"

// Attach to the demo browser opened by agent-browser; do not create or alter a user's browser profile.
const endpoint = process.argv[2]
if (!endpoint) throw new Error("Pass the demo browser's CDP URL from agent-browser get cdp-url")
const output = path.resolve(process.argv[3] ?? path.join(os.tmpdir(), "redcode-cube-studio"))
const browser = await chromium.connectOverCDP(endpoint)
try {
  const page = browser
    .contexts()[0]
    .pages()
    .find((page) => page.url().startsWith("http://127.0.0.1:3199/server/"))
  assert.ok(page, "The real Creator demo must already be open")
  const errors: string[] = []
  const external: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:3199" && !request.url().startsWith("data:"))
      external.push(request.url())
  })
  const iframe = page.locator('iframe[title="Cube studio component"]')
  const frame = iframe.contentFrame()
  await expect(frame.getByRole("heading", { name: "Cube studio", exact: true })).toBeVisible()
  assert.equal(await iframe.getAttribute("sandbox"), "allow-scripts")
  const canvas = frame.locator("canvas")
  const pixels = () =>
    canvas.evaluate((canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext("webgl")!
      const rgba = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
      const result = { colored: 0, red: 0, blue: 0 }
      for (let offset = 0; offset < rgba.length; offset += 4) {
        if (rgba[offset + 3] === 0) continue
        result.colored++
        result.red += rgba[offset]
        result.blue += rgba[offset + 2]
      }
      return result
    })
  await frame.getByRole("button", { name: "Material Coral", exact: true }).click()
  const coral = await pixels()
  assert.ok(coral.colored > 10_000 && coral.red > coral.blue, "Coral material must appear in actual WebGL pixels")
  await frame.getByRole("button", { name: "Material Azul", exact: true }).click()
  const blue = await pixels()
  assert.ok(blue.blue > blue.red, "Material control must change real WebGL pixels")
  const size = frame.getByRole("slider", { name: "Tamanho", exact: true })
  await size.focus()
  await size.press("ArrowRight")
  await expect(size).toHaveValue("1.05")
  const enlarged = await pixels()
  assert.ok(enlarged.colored > blue.colored, "Size control must enlarge the projected geometry")
  const wireframe = frame.getByRole("switch", { name: "Wireframe", exact: true })
  await wireframe.check()
  await expect(wireframe).toBeChecked()
  assert.notDeepEqual(await pixels(), enlarged, "Wireframe must change the rendered edges")
  await wireframe.uncheck()
  const rotation = await frame.locator(".rotation-readout").textContent()
  await canvas.focus()
  await canvas.press("ArrowRight")
  assert.notEqual(await frame.locator(".rotation-readout").textContent(), rotation)
  const bounds = await canvas.boundingBox()
  assert.ok(bounds)
  const beforeDrag = await frame.locator(".rotation-readout").textContent()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2 + 12, { steps: 5 })
  await page.mouse.up()
  assert.notEqual(await frame.locator(".rotation-readout").textContent(), beforeDrag)
  const beforeZoom = Number(await frame.getByRole("slider", { name: "Zoom", exact: true }).inputValue())
  await page.mouse.wheel(0, -100)
  await expect(frame.getByRole("slider", { name: "Zoom", exact: true })).toHaveValue(String(beforeZoom + 0.1))
  await frame.getByRole("button", { name: "Animar cubo", exact: true }).click()
  const animated = Number(await canvas.getAttribute("data-rendered"))
  await expect.poll(async () => Number(await canvas.getAttribute("data-rendered"))).toBeGreaterThan(animated + 2)
  await frame.getByRole("button", { name: "Pausar rotação", exact: true }).click()
  await frame.getByRole("button", { name: "Restaurar câmera", exact: true }).click()
  const idle = await canvas.getAttribute("data-rendered")
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal(await canvas.getAttribute("data-rendered"), idle, "Idle scene must not keep an animation loop running")
  const parentBlocked = await canvas.evaluate(() => {
    try {
      return parent.document === undefined
    } catch {
      return true
    }
  })
  assert.equal(parentBlocked, true)
  await page.mouse.move(700, 80)
  await page.screenshot({ path: path.join(output, "creator-cube-installed.png") })
  await page.getByRole("button", { name: "Expand to full width", exact: true }).click()
  await expect(page.getByRole("button", { name: "Expand to full width", exact: true })).toHaveCount(0)
  await page.screenshot({ path: path.join(output, "creator-cube-installed-expanded.png") })
  const info = JSON.parse(await Bun.file(path.join(output, "demo.json")).text())
  const inventory = await fetch(
    `http://127.0.0.1:3199/api/creator/component?location[directory]=${encodeURIComponent(info.directory)}`,
  ).then((response) => response.json())
  assert.equal(inventory.data.length, 1)
  assert.equal(inventory.data[0].name, "Cube studio")
  const report = {
    component: inventory.data[0],
    coral,
    blue,
    parentBlocked,
    idleFramesStable: true,
    actualDS: ["Button", "Badge", "Slider", "Switch"],
    verified: [
      "real persisted installation",
      "revision update through app UI",
      "recovery after demo server restart",
      "material",
      "size",
      "wireframe",
      "keyboard",
      "pointer drag",
      "wheel/zoom synchronization",
      "animation/pause",
      "idle render on demand",
    ],
    external,
    errors,
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  await Bun.write(path.join(output, "verification.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
