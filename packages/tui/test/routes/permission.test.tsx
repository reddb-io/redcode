/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import type { PermissionRequest } from "@reddb-io/redcode-sdk/v2"
import { PermissionPrompt } from "../../src/routes/session/permission"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { Toast, ToastProvider } from "../../src/ui/toast"
import { ExitProvider } from "../../src/context/exit"
import { LocationProvider } from "../../src/context/location"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { tmpdir } from "../fixture/fixture"
import { mount, wait } from "../cli/cmd/tui/sync-fixture"

const REQUEST: PermissionRequest = {
  id: "per_bash",
  sessionID: "ses_test",
  permission: "bash",
  patterns: ["ls"],
  metadata: {},
  always: ["ls"],
}

function Prompt(props: { onExit?: () => void; request?: PermissionRequest }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={config}>
        <ThemeProvider mode="dark">
          <ToastProvider>
            <LocationProvider>
              <ExitProvider exit={() => props.onExit?.()}>
                <PermissionPrompt request={props.request ?? REQUEST} />
              </ExitProvider>
            </LocationProvider>
            <Toast />
          </ToastProvider>
        </ThemeProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

// Same ceiling as `wait`: CI runs test files in parallel and a loaded runner can take seconds to render.
async function waitForFrame(setup: { app: { renderOnce(): Promise<void>; captureCharFrame(): string } }, text: string) {
  const start = Date.now()
  for (;;) {
    await setup.app.renderOnce()
    if (setup.app.captureCharFrame().includes(text)) return
    if (Date.now() - start > 10_000) throw new Error(`timed out waiting for "${text}"`)
    await Bun.sleep(10)
  }
}

async function setupPrompt(
  respond: (url: URL) => Response | Promise<Response> | undefined,
  onExit?: () => void,
  request: PermissionRequest = REQUEST,
) {
  const tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await mount(
    async (url) => respond(url),
    tmp.path,
    () => <Prompt onExit={onExit} request={request} />,
  )
  setup.sync.set("permission", "ses_test", [request])
  // ThemeProvider renders nothing until its palette and theme discovery settle, so a key pressed before
  // the prompt is on screen hits no binding. Wait for the prompt itself instead of sleeping.
  await waitForFrame(setup, "Allow once").catch(async (error: unknown) => {
    setup.app.renderer.destroy()
    await tmp[Symbol.asyncDispose]()
    throw error
  })
  return { setup, tmp }
}

test("a permission reply that fails with a server error keeps the prompt to retry", async () => {
  const calls: string[] = []
  const { setup, tmp } = await setupPrompt((url) => {
    if (url.pathname !== "/permission/per_bash/reply") return
    calls.push(url.pathname)
    return Response.json({ name: "UnknownError", data: { message: "database is locked" } }, { status: 500 })
  })
  try {
    setup.app.mockInput.pressKey("\r")
    await wait(() => calls.length === 1)
    await waitForFrame(setup, "failed")
    expect(setup.sync.data.permission.ses_test).toHaveLength(1)
  } finally {
    setup.app.renderer.destroy()
    await tmp[Symbol.asyncDispose]()
  }
})

test("a permission the server no longer knows is removed", async () => {
  const calls: string[] = []
  const { setup, tmp } = await setupPrompt((url) => {
    if (url.pathname !== "/permission/per_bash/reply") return
    calls.push(url.pathname)
    return Response.json(
      { _tag: "PermissionNotFoundError", requestID: "per_bash", message: "Permission request not found" },
      { status: 404 },
    )
  })
  try {
    setup.app.mockInput.pressKey("\r")
    await wait(() => calls.length === 1)
    await wait(() => (setup.sync.data.permission.ses_test ?? []).length === 0)
    await waitForFrame(setup, "no longer active")
  } finally {
    setup.app.renderer.destroy()
    await tmp[Symbol.asyncDispose]()
  }
})

test("Ctrl+C that left one permission stage does not arm an exit in the next", async () => {
  const calls: string[] = []
  let exits = 0
  const { setup, tmp } = await setupPrompt(
    (url) => {
      if (url.pathname !== "/permission/per_bash/reply") return
      calls.push(url.pathname)
      return new Promise<Response>(() => {})
    },
    () => exits++,
  )
  try {
    setup.app.mockInput.pressArrow("right")
    await setup.app.renderOnce()
    setup.app.mockInput.pressKey("\r")
    await waitForFrame(setup, "Confirm")
    setup.app.mockInput.pressKey("c", { ctrl: true })
    await waitForFrame(setup, "Allow once")
    setup.app.mockInput.pressKey("c", { ctrl: true })
    await wait(() => calls.length === 1)
    expect(exits).toBe(0)
    setup.app.mockInput.pressKey("c", { ctrl: true })
    await wait(() => exits === 1)
  } finally {
    setup.app.renderer.destroy()
    await tmp[Symbol.asyncDispose]()
  }
})

test("a request with nothing to remember offers no Allow always, and shows the monitor it approves", async () => {
  const { setup, tmp } = await setupPrompt(() => undefined, undefined, {
    ...REQUEST,
    id: "per_monitor",
    patterns: ["gh pr checks 12"],
    metadata: { command: "gh pr checks 12", monitor: 'poll every 1m, for up to 1h, fail on "fail"' },
    always: [],
  })
  try {
    await waitForFrame(setup, "Allow once")
    const frame = setup.app.captureCharFrame()
    expect(frame).toContain("Reject")
    expect(frame).not.toContain("Allow always")
    expect(frame).toContain("Monitor: poll every 1m")
  } finally {
    setup.app.renderer.destroy()
    await tmp[Symbol.asyncDispose]()
  }
})

test("a request with patterns to remember still offers Allow always", async () => {
  const { setup, tmp } = await setupPrompt(() => undefined)
  try {
    await waitForFrame(setup, "Allow always")
  } finally {
    setup.app.renderer.destroy()
    await tmp[Symbol.asyncDispose]()
  }
})
