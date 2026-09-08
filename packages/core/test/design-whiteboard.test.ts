import { expect, test } from "bun:test"
import { chromium } from "playwright-core"
import { DesignWhiteboard } from "../src/design/whiteboard"

test.each(["fonts/Probe.woff2", "fonts\\Probe.woff2"])(
  "whiteboard loads %s through data URLs in its opaque sandbox",
  async (name) => {
    const font = await Bun.file(new URL("../../app/public/assets/brand/SpaceGrotesk.woff2", import.meta.url)).bytes()
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const network: string[] = []
      page.on("request", (request) => {
        if (/^https?:/.test(request.url())) network.push(request.url())
      })
      await page.setContent('<iframe sandbox="allow-scripts"></iframe>')
      await page.evaluate(
        (html) => {
          document.querySelector("iframe")!.srcdoc = html
        },
        DesignWhiteboard.render({
          fonts: { [name]: `data:font/woff2;base64,${Buffer.from(font).toString("base64")}` },
          css: "",
          script: `window.EXCALIDRAW_ASSET_PATH = \`\${location.origin}/design/vendor/whiteboard/\`;
            try {
              const url = window.EXCALIDRAW_ASSET_PATH + "fonts/Probe.woff2";
              const response = await fetch(url);
              const face = new FontFace("Probe", 'url("' + url + '")');
              await face.load();
              document.fonts.add(face);
              document.body.dataset.loaded = face.status;
              document.body.dataset.bytes = String((await response.arrayBuffer()).byteLength);
              document.body.dataset.url = response.url;
            } catch (error) {
              document.body.dataset.error = String(error);
            }`,
        }),
      )
      const frame = page.frameLocator("iframe")
      await frame.locator("body[data-loaded],body[data-error]").waitFor({ state: "attached" })
      expect(await frame.locator("body").getAttribute("data-error")).toBeNull()
      expect(await frame.locator("body").getAttribute("data-loaded")).toBe("loaded")
      expect(await frame.locator("body").getAttribute("data-bytes")).toBe(String(font.byteLength))
      expect(await frame.locator("body").getAttribute("data-url")).toStartWith("data:font/woff2;base64,")
      expect(network).toEqual([])
    } finally {
      await browser.close()
    }
  },
  30000,
)
