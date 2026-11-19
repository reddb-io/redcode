import fs from "fs/promises"
import path from "path"
import os from "os"
import { describe, expect, test } from "bun:test"
import { DesignPage } from "@opencode/core/design/ui/page"
import { liveFrame } from "@opencode/core/design/ui/live"

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
    const closed = await DesignPage.preview(revision, directory)
    expect(closed).not.toContain(shim)
    expect(closed).toContain(`content="${DesignPage.FRAME_CSP}"`)
    await fs.rm(directory, { recursive: true, force: true })
  })

  test("tells the presentation page whether its slide gets the microphone", () => {
    const options = (html: string) => html.match(/"microphone":(true|false)/)?.[1]
    expect(options(DesignPage.present("/design/session/ses/x", "des_live", "audience", undefined, grant))).toBe("true")
    expect(options(DesignPage.present("/design/session/ses/x", "des_live", "presenter"))).toBe("false")
  })
})
