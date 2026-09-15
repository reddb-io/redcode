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

const CONNECT = "/provider/9router/connect"
const connectedResult = {
  baseURL: "http://localhost:20128/v1",
  models: [{ id: "combo", name: "Combo", limit: { context: 128000, output: 8192 }, estimated: true }],
}

async function mountWizard(root: string, url: string, onConnected: (baseURL: string) => Promise<void>) {
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

test("9Router wizard normalizes the URL and connects through one server call", async () => {
  await using tmp = await tmpdir()
  const requests: Array<{ path: string; body: unknown }> = []
  const connected: string[] = []
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      requests.push({ path, body: request.method === "GET" ? undefined : await request.json() })
      if (path === CONNECT) return Response.json(connectedResult)
      return Response.json({})
    },
  })
  const wizard = await mountWizard(tmp.path, server.url.href, async (baseURL) => {
    connected.push(baseURL)
  })
  try {
    await wizard.input("localhost:20128")
    await wizard.input(" test-key ")
    await wait(() => connected.length === 1)
    expect(requests).toEqual([{ path: CONNECT, body: { baseURL: "http://localhost:20128/v1", apiKey: "test-key" } }])
    expect(connected).toEqual(["http://localhost:20128/v1"])
  } finally {
    wizard.app.renderer.destroy()
  }
})

test("an invalid URL or refused key sends nothing further and lets the user retry", async () => {
  await using tmp = await tmpdir()
  const paths: string[] = []
  const connected: string[] = []
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      paths.push(path)
      if (path === CONNECT) {
        const body = await request.json()
        if (body.apiKey === "bad")
          return Response.json({ message: "The provider refused this API key." }, { status: 400 })
        return Response.json(connectedResult)
      }
      return Response.json({})
    },
  })
  const wizard = await mountWizard(tmp.path, server.url.href, async (baseURL) => {
    connected.push(baseURL)
  })
  try {
    await wizard.input("ftp://router")
    expect(wizard.app.captureCharFrame()).toContain("Enter an HTTP or HTTPS API URL")
    expect(paths).toEqual([])
    await wizard.input("http://127.0.0.1:20128/v1/models")
    await wizard.input("bad")
    await wait(() => paths.length === 1 && wizard.app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await wizard.app.renderOnce()
    expect(wizard.app.captureCharFrame()).toContain("refused this API key")
    expect(connected).toEqual([])
    await wizard.input("good")
    await wait(() => connected.length === 1)
    expect(paths).toEqual([CONNECT, CONNECT])
  } finally {
    wizard.app.renderer.destroy()
  }
})

test("a problem found after connecting is shown in the wizard", async () => {
  await using tmp = await tmpdir()
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json(connectedResult),
  })
  const wizard = await mountWizard(tmp.path, server.url.href, async () => {
    throw new Error("Project override found")
  })
  try {
    await wizard.input("http://127.0.0.1:20128/v1")
    await wizard.input("test-key")
    await wait(() => wizard.app.captureCharFrame().includes("Project override found"))
  } finally {
    wizard.app.renderer.destroy()
  }
})

test("busy setup blocks duplicate submits and cancel does not report a connection", async () => {
  await using tmp = await tmpdir()
  const gate = Promise.withResolvers<Response>()
  const paths: string[] = []
  const connected: string[] = []
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      paths.push(new URL(request.url).pathname)
      return gate.promise
    },
  })
  const wizard = await mountWizard(tmp.path, server.url.href, async (baseURL) => {
    connected.push(baseURL)
  })
  try {
    await wizard.input("http://127.0.0.1:20128/v1")
    await wizard.input("test-key")
    await wait(() => paths.length === 1)
    wizard.app.mockInput.pressEnter()
    wizard.app.mockInput.pressEnter()
    wizard.app.mockInput.pressEscape()
    gate.resolve(Response.json(connectedResult))
    await wizard.app.renderOnce()
    expect(paths).toEqual([CONNECT])
    expect(connected).toEqual([])
    expect(wizard.app.captureCharFrame()).not.toContain("9Router · API key")
  } finally {
    gate.resolve(Response.json({}))
    wizard.app.renderer.destroy()
  }
})
