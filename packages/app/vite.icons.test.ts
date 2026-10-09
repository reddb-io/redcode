import { expect, test } from "bun:test"
import { fetch } from "bun"
import { build, createServer } from "vite"
import { icons } from "./vite.icons"
import manifest from "./manifest.json" with { type: "json" }
import platform from "../design-system/platform/platform-manifest.json" with { type: "json" }

test("bundles the design system's platform icons", async () => {
  const result = await build({
    root: import.meta.dirname,
    configFile: false,
    logLevel: "silent",
    plugins: [
      icons(),
      {
        name: "icons-only-fixture",
        transformIndexHtml: {
          order: "pre",
          handler: (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""),
        },
      },
    ],
    build: { write: false, copyPublicDir: false },
  })

  if (!("output" in result)) throw new Error("Expected a single build output")

  await check(async (path) => {
    const file = result.output.find((file) => `/${file.fileName}` === path)

    if (file?.type !== "asset") throw new Error(`Missing asset: ${path}`)

    return new Uint8Array(Buffer.from(file.source))
  })
})

test("serves the design system's platform icons", async () => {
  const server = await createServer({
    root: import.meta.dirname,
    configFile: false,
    logLevel: "silent",
    plugins: [icons()],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: "127.0.0.1", port: 0, hmr: false, preTransformRequests: false, watch: null },
  })

  try {
    await server.listen()
    const url = server.resolvedUrls?.local[0]

    if (!url) throw new Error("Expected a local URL")

    await check(async (path) => {
      const response = await fetch(new URL(path, url))
      expect(response.status).toBe(200)

      if (path.endsWith(".webmanifest")) expect(response.headers.get("content-type")).toBe("application/manifest+json")

      if (path.endsWith(".png")) expect(response.headers.get("content-type")).toBe("image/png")

      return new Uint8Array(await response.arrayBuffer())
    })
  } finally {
    await server.close()
  }
})

async function check(read: (path: string) => Promise<Uint8Array>) {
  const html = new TextDecoder().decode(await read("/index.html"))
  const actual = JSON.parse(new TextDecoder().decode(await read("/site.webmanifest")))
  expect(actual).toEqual({ ...manifest, icons: platform.manifestIcons })
  expect(html).toContain(`href="/favicon.svg"`)
  expect(html).toContain(`href="/favicon.ico"`)
  expect(html).toContain(`href="/apple-touch-icon-180.png"`)
  expect(html).toContain(`href="/site.webmanifest"`)

  await Promise.all(
    platform.icons.map(async (icon) => {
      expect(await read(`/${icon.file}`)).toEqual(
        await Bun.file(new URL(`../design-system/platform/${icon.file}`, import.meta.url)).bytes(),
      )
    }),
  )
}
