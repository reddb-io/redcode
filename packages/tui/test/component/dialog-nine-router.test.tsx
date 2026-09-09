/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogNineRouter } from "../../src/component/dialog-nine-router"
import { useDialog } from "../../src/ui/dialog"
import { mountDialog } from "../fixture/dialog"
import { tmpdir } from "../fixture/fixture"
import { eventSource } from "../fixture/tui-sdk"
import { wait } from "../cli/cmd/tui/sync-fixture"

async function mountWizard(root: string, url: string, onConnected: () => Promise<void>) {
  function Open() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogNineRouter onConnected={onConnected} />))
    return null
  }
  const app = await mountDialog({
    root,
    sdk: { url, events: eventSource() },
    children: () => <Open />,
  })
  return {
    app,
    async input(value: string) {
      await wait(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
      const textarea = app.renderer.currentFocusedEditor
      if (!(textarea instanceof TextareaRenderable)) throw new Error("Wizard input not focused")
      textarea.setText(value)
      await app.mockInput.pressEnter()
      await app.renderOnce()
    },
  }
}

test("9Router wizard discovers models and saves globally without putting the key in config", async () => {
  await using tmp = await tmpdir()
  const requests: Array<{ path: string; body: unknown }> = []
  const connected: boolean[] = []
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      const body = request.method === "GET" ? undefined : await request.json()
      requests.push({ path, body })
      if (path === "/provider/discover")
        return Response.json({
          baseURL: "http://127.0.0.1:20128/v1",
          models: [
            { id: "cc/model", name: "Claude" },
            { id: "combo", name: "Combo" },
          ],
        })
      if (path === "/global/config" && request.method === "GET")
        return Response.json({
          provider: {
            "9router": { models: { "cc/model": { name: "My Claude", limit: { context: 10000, output: 1000 } } } },
            other: { name: "Keep me" },
          },
        })
      return Response.json({})
    },
  })
  const wizard = await mountWizard(tmp.path, server.url.href, async () => {
    connected.push(true)
  })
  try {
    await wizard.input("http://127.0.0.1:20128")
    await wizard.input("test-key")
    await wait(() => connected.length === 1)
    expect(requests.map((request) => request.path)).toEqual([
      "/provider/discover",
      "/global/config",
      "/auth/9router",
      "/global/config",
    ])
    expect(requests[0].body).toEqual({ baseURL: "http://127.0.0.1:20128/v1", apiKey: "test-key" })
    expect(requests[2].body).toEqual({ type: "api", key: "test-key" })
    expect(requests[3].body).toEqual({
      provider: {
        "9router": {
          name: "9Router",
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://127.0.0.1:20128/v1" },
          models: { "cc/model": {}, combo: { name: "Combo" } },
        },
      },
    })
    expect(JSON.stringify(requests[3].body)).not.toContain("test-key")
  } finally {
    wizard.app.renderer.destroy()
  }
})

test("a refused key leaves configuration untouched and lets the user retry", async () => {
  await using tmp = await tmpdir()
  const paths: string[] = []
  const connected: boolean[] = []
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      paths.push(path)
      if (path === "/provider/discover") {
        const body = await request.json()
        if (body.apiKey === "bad")
          return Response.json({ message: "The provider refused this API key." }, { status: 400 })
        return Response.json({ baseURL: "http://127.0.0.1:20128/v1", models: [{ id: "combo", name: "Combo" }] })
      }
      return Response.json({})
    },
  })
  const wizard = await mountWizard(tmp.path, server.url.href, async () => {
    connected.push(true)
  })
  try {
    await wizard.input("invalid")
    expect(paths).toEqual([])
    await wizard.input("http://127.0.0.1:20128/v1")
    await wizard.input("bad")
    await wait(() => paths.length === 1 && wizard.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await wizard.app.renderOnce()
    expect(wizard.app.captureCharFrame()).toContain("refused this API key")
    expect(paths).toEqual(["/provider/discover"])
    await wizard.input("good")
    await wait(() => connected.length === 1)
    expect(paths.filter((path) => path === "/auth/9router")).toHaveLength(1)
  } finally {
    wizard.app.renderer.destroy()
  }
})

test("busy setup blocks duplicate submits and cancel prevents credential writes", async () => {
  await using tmp = await tmpdir()
  const gate = Promise.withResolvers<Response>()
  const paths: string[] = []
  const connected: boolean[] = []
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      paths.push(new URL(request.url).pathname)
      return gate.promise
    },
  })
  const wizard = await mountWizard(tmp.path, server.url.href, async () => {
    connected.push(true)
  })
  try {
    await wizard.input("http://127.0.0.1:20128/v1")
    await wizard.input("test-key")
    await wait(() => paths.length === 1)
    wizard.app.mockInput.pressEnter()
    wizard.app.mockInput.pressEnter()
    wizard.app.mockInput.pressEscape()
    gate.resolve(Response.json({ baseURL: "http://127.0.0.1:20128/v1", models: [{ id: "combo", name: "Combo" }] }))
    await wizard.app.renderOnce()
    expect(paths).toEqual(["/provider/discover"])
    expect(connected).toEqual([])
    expect(wizard.app.captureCharFrame()).not.toContain("9Router · API key")
  } finally {
    gate.resolve(Response.json({}))
    wizard.app.renderer.destroy()
  }
})
