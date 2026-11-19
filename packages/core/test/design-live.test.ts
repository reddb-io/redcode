import fs from "fs/promises"
import path from "path"
import os from "os"
import { describe, expect, test } from "bun:test"
import { DesignPage } from "@opencode/core/design/ui/page"
import { liveFrame } from "@opencode/core/design/ui/live"
import { DesignExport } from "@opencode/core/design/export"
import { DesignDocumentTool } from "@opencode/core/design/document-tool"
import { simulate } from "@opencode/core/design/ui/device"
import { Design } from "@opencode/schema/design"
import { Schema } from "effect"

const grant = { microphone: true, origins: ["wss://api.hume.ai", "https://api.hume.ai"] }
const directive = (policy: string, name: string) => policy.split("; ").find((item) => item.startsWith(`${name} `))

describe("design live grant", () => {
  test("leaves both policies alone without a grant", () => {
    expect(DesignPage.livePolicy(DesignPage.FRAME_CSP, undefined)).toBe(DesignPage.FRAME_CSP)
    expect(DesignPage.livePolicy(DesignPage.CSP, { origins: [] })).toBe(DesignPage.CSP)
  })

  test("opens connections and scripts to the granted origins only, in the frame and in its page", () => {
    const frame = DesignPage.livePolicy(DesignPage.FRAME_CSP, grant)
    expect(directive(frame, "connect-src")).toBe("connect-src wss://api.hume.ai https://api.hume.ai")
    expect(directive(frame, "script-src")).toBe("script-src 'unsafe-inline' wss://api.hume.ai https://api.hume.ai")
    expect(directive(frame, "media-src")).toBe("media-src 'self' blob: data: wss://api.hume.ai https://api.hume.ai")
    expect(directive(frame, "img-src")).toBe("img-src data: blob:")
    expect(directive(frame, "base-uri")).toBe("base-uri 'none'")
    const page = DesignPage.livePolicy(DesignPage.CSP, grant)
    expect(directive(page, "connect-src")).toBe("connect-src 'self' data: wss://api.hume.ai https://api.hume.ai")
    expect(directive(page, "frame-src")).toBe("frame-src 'self'")
  })

  test("gives the frame the microphone bridge only when the design was granted the microphone", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "design-live-"))
    await fs.writeFile(path.join(directory, "index.html"), `<section class="slide" id="intro"></section>`)
    const revision = {
      id: "rev_live",
      document: { engine: "html", entry: "index.html", target: "presentation", controls: [] },
    } as never
    const shim = `(${liveFrame.toString()})()`
    expect(await DesignPage.preview(revision, directory, grant)).toContain(shim)
    expect(await DesignPage.preview(revision, directory, { origins: grant.origins })).not.toContain(shim)
    expect(await DesignPage.preview(revision, directory, { camera: true })).toContain(shim)
    const closed = await DesignPage.preview(revision, directory)
    expect(closed).not.toContain(shim)
    expect(closed).toContain(`content="${DesignPage.FRAME_CSP}"`)
    await fs.rm(directory, { recursive: true, force: true })
  })

  test("the HTML export keeps references to granted origins and still embeds or refuses every other one", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "design-live-export-"))
    await fs.writeFile(path.join(directory, "app.js"), "window.local = true")
    await fs.writeFile(
      path.join(directory, "index.html"),
      `<script src="https://api.hume.ai/sdk.js"></script><script src="app.js"></script><section class="slide" id="intro"></section>`,
    )
    const exported = await DesignExport.html(directory, "index.html", grant.origins)
    expect(exported).toContain(`<script src="https://api.hume.ai/sdk.js"></script>`)
    expect(exported).toContain("window.local = true")
    expect(DesignExport.html(directory, "index.html")).rejects.toThrow("Export requires a local resource")
    await fs.rm(directory, { recursive: true, force: true })
  })

  test("every preview runs on the simulated device, granted or not", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "design-device-"))
    await fs.writeFile(path.join(directory, "index.html"), `<main></main>`)
    const revision = { id: "rev_device", document: { engine: "html", entry: "index.html", controls: [] } } as never
    const html = await DesignPage.preview(revision, directory)
    expect(html).toContain(`(${simulate.toString()})()`)
    // The real-location bridge comes first, so the simulated geolocation can fall back to it.
    const located = await DesignPage.preview(revision, directory, { location: true })
    expect(located.indexOf(`(${liveFrame.toString()})()`)).toBeLessThan(located.indexOf(`(${simulate.toString()})()`))
    await fs.rm(directory, { recursive: true, force: true })
  })

  test("takes a scenario's device state within the ranges the browser APIs report", () => {
    const valid = Schema.is(Design.DeviceState)
    expect(
      valid({
        battery: { level: 0.05, charging: false },
        network: "offline",
        location: { latitude: 48.85, longitude: 2.35 },
        orientation: { alpha: 0, beta: 30, gamma: -15 },
        clock: "2026-11-19T23:30",
      }),
    ).toBe(true)
    expect(valid({ battery: { level: 5, charging: false } })).toBe(false)
    expect(valid({ network: "5g" })).toBe(false)
    expect(valid({ location: { latitude: 91, longitude: 0 } })).toBe(false)
    expect(valid({ clock: "tomorrow" })).toBe(false)
  })

  test("asks only for the devices and origins a grant adds", () => {
    expect(
      DesignDocumentTool.grants(
        { microphone: true, origins: ["wss://api.hume.ai"] },
        { microphone: true, camera: true, origins: ["wss://api.hume.ai", "https://cdn.example.com"] },
      ),
    ).toEqual(["camera", "https://cdn.example.com"])
    expect(DesignDocumentTool.grants({ camera: true }, { camera: false })).toEqual([])
    expect(DesignDocumentTool.grants(undefined, { location: true })).toEqual(["location"])
  })

  test("tells the presentation page whether its slide gets the microphone", () => {
    const options = (html: string) => html.match(/"microphone":(true|false)/)?.[1]
    expect(options(DesignPage.present("/design/session/ses/x", "des_live", "audience", undefined, grant))).toBe("true")
    expect(options(DesignPage.present("/design/session/ses/x", "des_live", "presenter"))).toBe("false")
    expect(
      DesignPage.present("/design/session/ses/x", "des_live", "presenter", undefined, { camera: true }),
    ).toContain(`"camera":true`)
  })
})
