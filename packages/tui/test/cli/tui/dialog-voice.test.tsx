/** @jsxImportSource @opentui/solid */
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { showVoiceSettings } from "../../../src/component/dialog-voice"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider, useClient } from "../../../src/context/client"
import { Keymap } from "../../../src/context/keymap"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { Toast, ToastProvider, useToast } from "../../../src/ui/toast"
import { emptyThemeSource } from "../../fixture/fixture"
import { createApi, createFetch, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("configures voice inside the TUI with a masked new key and reopens saved settings", async () => {
  let saved: unknown
  const keys: unknown[] = []
  const connections = [{ id: "cred_existing", label: "Existing key", integrationID: "openai" }]
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/config") return json(saved ? [{ type: "document", info: { voice: saved } }] : [])
    if (url.pathname === "/api/voice/connections") {
      if (request.method === "POST") {
        keys.push(await request.json())
        const entry = { id: "cred_voice", label: "My voice", integrationID: "redcode-voice" }
        connections.push(entry)
        return json({ data: entry })
      }
      return json({ data: connections })
    }
    if (url.pathname === "/api/experimental/config") {
      saved = (await request.json()).voice
      return new Response(null, { status: 204 })
    }
    return undefined
  })
  let reopen = async () => {}
  function Probe() {
    const client = useClient()
    const dialog = useDialog()
    const toast = useToast()
    reopen = () => showVoiceSettings({ api: client.api, dialog, toast })
    onMount(() => void reopen())
    return null
  }
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
              <ClientProvider api={createApi(calls.fetch)}>
                <ThemeProvider mode="dark" source={emptyThemeSource}>
                  <DialogProvider>
                    <Probe />
                  </DialogProvider>
                  <Toast />
                </ThemeProvider>
              </ClientProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 90, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  try {
    await app.waitForFrame((frame) => frame.includes("Save voice settings"))
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Add a voice API key"))
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await app.mockInput.typeText("My voice")
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Voice API key"))
    await app.mockInput.typeText("fixture-private-key")
    await app.waitForFrame((frame) => frame.includes("●") || frame.includes("•"))
    expect(app.captureCharFrame()).not.toContain("fixture-private-key")
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Save voice settings") && frame.includes("My voice"))
    expect(keys).toEqual([{ label: "My voice", key: "fixture-private-key" }])
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    app.mockInput.pressArrow("down")
    app.mockInput.pressArrow("down")
    app.mockInput.pressArrow("down")
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await app.mockInput.typeText("pt")
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Save voice settings") && frame.includes("pt"))
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    app.mockInput.pressArrow("down")
    app.mockInput.pressArrow("down")
    app.mockInput.pressArrow("down")
    app.mockInput.pressArrow("down")
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.waitFor(() => saved !== undefined)
    expect(saved).toEqual({
      provider: "openai",
      model: "gpt-4o-mini-transcribe",
      connection: { type: "credential", id: "cred_voice" },
      language: "pt",
    })
    await reopen()
    await app.waitForFrame((frame) => frame.includes("My voice") && frame.includes("pt"))
    expect(app.captureCharFrame()).not.toContain("fixture-private-key")
  } finally {
    app.renderer.destroy()
  }
})
