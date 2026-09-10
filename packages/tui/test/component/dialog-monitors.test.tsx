/** @jsxImportSource @opentui/solid */
import { InputRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, onMount } from "solid-js"
import { DialogMonitors } from "../../src/component/dialog-monitors"
import { ClipboardProvider } from "../../src/context/clipboard"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { tmpdir } from "../fixture/fixture"
import { mount, wait, json } from "../cli/cmd/tui/sync-fixture"

function Dialogs() {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  function Open() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogMonitors sessionID="ses_owner" />))
    return null
  }
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={config}>
        <ThemeProvider mode="dark">
          <ClipboardProvider>
            <ToastProvider>
              <DialogProvider>
                <Open />
              </DialogProvider>
            </ToastProvider>
          </ClipboardProvider>
        </ThemeProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

test("monitor list handles server failure without losing the dialog", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await mount(
    (url) => (url.pathname.endsWith("/monitors") ? new Response("failed", { status: 500 }) : undefined),
    tmp.path,
    () => <Dialogs />,
  )
  try {
    await wait(() => setup.app.renderer.currentFocusedRenderable instanceof InputRenderable)
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).toContain("Could not load monitors")
    expect(setup.app.renderer.currentFocusedRenderable).toBeInstanceOf(InputRenderable)
  } finally {
    setup.app.renderer.destroy()
  }
})

test("monitor dialog inspects and cancels once while keeping the originating session", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const gate = Promise.withResolvers<Response>()
  const requests: string[] = []
  let info = {
    id: "monitor_one",
    sessionID: "ses_owner",
    command: "status job-42",
    workdir: "/project",
    status: "running",
    attempts: 2,
    created: 1,
    updated: 2,
    options: { mode: "poll" },
    delivery: "pending",
    evidence: { exit: 1, output: "pending", truncated: false },
  }
  const setup = await mount(
    (url) => {
      if (url.pathname === "/experimental/session/ses_owner/monitors") return json([info])
      if (url.pathname.endsWith("/cancel")) {
        requests.push(url.pathname)
        return gate.promise
      }
    },
    tmp.path,
    () => <Dialogs />,
  )
  try {
    await wait(() => setup.app.renderer.currentFocusedRenderable instanceof InputRenderable)
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).toContain("status job-42")
    setup.app.mockInput.pressEnter()
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).toContain("View last result")
    setup.app.mockInput.pressArrow("down")
    setup.app.mockInput.pressEnter()
    await wait(() => requests.length === 1)
    setup.app.mockInput.pressEnter()
    expect(requests).toEqual(["/experimental/session/ses_owner/monitors/monitor_one/cancel"])
    const previous = setup.app.renderer.currentFocusedRenderable
    info = { ...info, status: "cancelled", delivery: "suppressed" }
    gate.resolve(json(info))
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        setup.app.renderer.currentFocusedRenderable !== previous,
    )
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).toContain("cancelled")
  } finally {
    gate.resolve(json(info))
    setup.app.renderer.destroy()
  }
})
