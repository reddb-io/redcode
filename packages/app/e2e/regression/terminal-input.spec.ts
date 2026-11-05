import { base64Encode, checksum } from "@opencode/util/encode"
import { expect, test } from "@playwright/test"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import path from "node:path"
import { sessionHref } from "../utils/app"
import { mockWorkspace, openSession, type WorkspaceInput } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

const workspace = { name: "TerminalInput", pty: {} } satisfies WorkspaceInput

test.use({ viewport: { width: 1440, height: 900 } })

test("Windows browser and TUI protocol share a real persistent ConPTY", async ({ page }) => {
  test.skip(process.platform !== "win32", "This exercises Windows ConPTY")
  test.setTimeout(60_000)
  const child = spawn("bun", [path.resolve("../server/test/fixture/persistent-browser-server.ts")], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  const lines = createInterface({ input: child.stdout })
  let diagnostic = ""
  child.stderr.on("data", (chunk: Buffer) => {
    diagnostic += chunk.toString()
  })
  const base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${diagnostic}`)), 30_000)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`Server exited ${code}: ${diagnostic}`))
    })
    lines.on("line", (line) => {
      if (!line.startsWith("FIXTURE_READY ")) return
      clearTimeout(timer)
      resolve(line.slice("FIXTURE_READY ".length))
    })
  }).catch((error) => {
    child.kill()
    lines.close()
    throw error
  })
  const headers = {
    authorization: `Basic ${Buffer.from("opencode:test-only").toString("base64")}`,
    "content-type": "application/json",
  }
  let peer: WebSocket | undefined
  try {
    const workspace = await mockWorkspace(page, { name: "RealConpty", pty: {} })
    const sessionID = workspace.sessions[0]!.id
    const createdResponse = await fetch(`${base}/api/experimental/session/${sessionID}/terminal`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        command: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
        args: ["/d", "/q", "/k", "echo REAL_CONPTY_READY"],
        cwd: process.cwd(),
        title: "Real shared terminal",
        env: {},
      }),
    })
    expect(createdResponse.ok).toBe(true)
    const created = (await createdResponse.json()).data
    const id: string = created.id
    const token = async () =>
      (
        await (
          await fetch(`${base}/api/experimental/persistent-pty/${id}/connect-token`, {
            method: "POST",
            headers: { ...headers, "x-opencode-ticket": "1" },
          })
        ).json()
      ).data.ticket as string
    const socketURL = (ticket: string, attachment: string) =>
      `${base.replace(/^http/, "ws")}/api/experimental/persistent-pty/${id}/connect?ticket=${ticket}&cursor=0&attachment_id=${attachment}&takeover=true&input_protocol=1`
    const browserOutput: string[] = []
    const controls: string[] = []
    const browserInput: string[] = []
    const network: string[] = []
    await page.route(
      /\/api\/experimental\/(?:session\/[^/]+\/terminal|persistent-pty\/[^/]+\/(?:snapshot|connect-token))(?:\?.*)?$/,
      async (route) => {
        const cors = {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
        }
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
        const source = new URL(route.request().url())
        network.push(`${route.request().method()} ${source.pathname}`)
        const response = await fetch(`${base}${source.pathname}${source.search}`, {
          method: route.request().method(),
          headers: { ...headers, "x-opencode-ticket": "1" },
        })
        return route.fulfill({
          status: response.status,
          headers: { ...cors, "content-type": response.headers.get("content-type") ?? "application/json" },
          body: Buffer.from(await response.arrayBuffer()),
        })
      },
    )
    await page.routeWebSocket(/\/api\/experimental\/persistent-pty\/[^/]+\/connect\?/, (socket) => {
      const source = new URL(socket.url())
      network.push(`SOCKET ${source.pathname}`)
      const remote = new WebSocket(`${base.replace(/^http/, "ws")}${source.pathname}${source.search}`)
      remote.binaryType = "arraybuffer"
      const pending: (string | Buffer)[] = []
      socket.onMessage((data) => {
        if (typeof data !== "string") browserInput.push(Buffer.from(data).toString("hex"))
        if (remote.readyState === WebSocket.OPEN) remote.send(data)
        else pending.push(data)
      })
      remote.addEventListener("open", () => pending.splice(0).forEach((data) => remote.send(data)))
      remote.addEventListener("error", () => network.push("SOCKET ERROR"))
      remote.addEventListener("close", (event) => network.push(`SOCKET CLOSE ${event.code}`))
      remote.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) {
          browserOutput.push(new TextDecoder().decode(event.data))
          socket.send(Buffer.from(event.data))
        } else {
          controls.push(String(event.data))
          socket.send(String(event.data))
        }
      })
      remote.addEventListener("close", () => socket.close())
      socket.onClose(() => remote.close())
    })
    await page.goto(sessionHref(sessionID))
    await expectSessionTitle(page, "RealConpty")
    await page.keyboard.press("Control+Backquote")
    const terminal = page.locator('[data-component="terminal"]')
    await expect(page.locator('[data-slot="terminal-tabs-toolbar"]').getByRole("tab")).toHaveCount(1)
    await terminal.click()
    await page.keyboard.type("echo XY42GUI")
    await page.keyboard.press("Enter")
    await expect
      .poll(
        async () =>
          (await (await fetch(`${base}/api/experimental/persistent-pty/${id}/snapshot`, { headers })).json()).data
            .text as string,
      )
      .toContain("\nXY42GUI")
      .catch((error) => {
        throw new Error(`network=${network.join("|")} controls=${controls.join("|")} input=${browserInput.join("|")}`, {
          cause: error,
        })
      })
    peer = new WebSocket(socketURL(await token(), "tui-test"))
    peer.binaryType = "arraybuffer"
    const peerOutput: string[] = []
    peer.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) peerOutput.push(new TextDecoder().decode(event.data))
    })
    await new Promise<void>((resolve, reject) => {
      const messages: string[] = []
      const timer = setTimeout(() => reject(new Error(`TUI socket replay timed out: ${messages.join("|")}`)), 8_000)
      peer!.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return
        messages.push(event.data)
        if (JSON.parse(event.data).type !== "replay_complete") return
        clearTimeout(timer)
        resolve()
      })
      peer!.addEventListener("error", () => {
        clearTimeout(timer)
        reject(new Error("TUI protocol socket failed"))
      })
      peer!.addEventListener("close", (event) => {
        clearTimeout(timer)
        reject(new Error(`TUI socket closed: ${event.code} ${event.reason}`))
      })
    })
    const text = new TextEncoder().encode("echo XY42TUI\r")
    const frame = new Uint8Array(5 + text.length)
    frame.set([1, 0, 80, 0, 24])
    frame.set(text, 5)
    peer.send(frame)
    await expect.poll(() => browserOutput.join("")).toContain("XY42TUI")
    await expect
      .poll(
        async () =>
          (await (await fetch(`${base}/api/experimental/persistent-pty/${id}/snapshot`, { headers })).json()).data
            .text as string,
      )
      .toContain("\nXY42TUI")
    await terminal.click()
    await page.keyboard.type("echo XY42BACK")
    await page.keyboard.press("Enter")
    await expect.poll(() => peerOutput.join("")).toContain("XY42BACK")
    await expect
      .poll(
        async () =>
          (await (await fetch(`${base}/api/experimental/persistent-pty/${id}/snapshot`, { headers })).json()).data
            .text as string,
      )
      .toContain("\nXY42BACK")
    expect(workspace.pty.created).toHaveLength(0)
    await fetch(`${base}/api/experimental/persistent-pty/${id}`, { method: "DELETE", headers })
  } finally {
    peer?.close()
    child.stdin.end()
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve()
      child.once("exit", () => resolve())
    })
    lines.close()
  }
})

test("shares an existing session terminal and reconnects it without creating another", async ({ page }) => {
  const workspace = await mockWorkspace(page, { name: "PersistentTerminal", pty: {} })
  const sessionID = workspace.sessions[0]!.id
  const info = {
    id: "pty_shared",
    sessionID,
    title: "Shared shell",
    command: "cmd.exe",
    args: [],
    cwd: workspace.directory,
    pid: 42,
    status: "running" as const,
    foregroundProcess: null,
    size: { cols: 80, rows: 24 },
    output: { head: 0, tail: 0 },
  }
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  }
  let creates = 0
  const list = [info]
  let connections = 0
  const inputs: string[] = []
  let close: (() => void) | undefined
  await page.route(
    /\/api\/experimental\/(?:session\/[^/]+\/terminal|persistent-pty\/pty_shared\/(?:snapshot|connect-token))(?:\?.*)?$/,
    (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers })
      const path = new URL(route.request().url()).pathname
      if (path.endsWith("/terminal")) {
        if (route.request().method() === "POST") {
          creates++
          return route.fulfill({ headers, json: { data: info } })
        }
        return route.fulfill({ headers, json: { data: list } })
      }
      if (path.endsWith("/snapshot"))
        return route.fulfill({
          headers,
          json: {
            data: {
              info,
              text: "shared ready",
              checkpoint: Buffer.from("shared ready").toString("base64"),
              cursor: { x: 12, y: 0 },
            },
          },
        })
      return route.fulfill({ headers, json: { data: { ticket: "ticket", expires_in: 60 } } })
    },
  )
  await page.routeWebSocket(/\/api\/experimental\/persistent-pty\/pty_shared\/connect\?/, (socket) => {
    connections++
    close = () => socket.close({ code: 1011, reason: "interrupted" })
    socket.onMessage((message) => {
      if (typeof message === "string") return
      const bytes = Buffer.from(message)
      if (bytes[0] === 1) inputs.push(bytes.subarray(5).toString())
    })
    socket.send(JSON.stringify({ type: "attached", inputProtocol: 1, role: "controller", info }))
    socket.send(JSON.stringify({ type: "replay_complete" }))
  })
  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, "PersistentTerminal")
  await page.keyboard.press("Control+Backquote")
  const terminal = page.locator('[data-component="terminal"]')
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await expect.poll(() => connections).toBe(1)
  await expect(page.getByRole("tab", { name: "Shared shell" })).toBeVisible()
  await terminal.click()
  await page.keyboard.type("hello")
  await expect.poll(() => inputs.join("")).toContain("hello")
  close?.()
  await expect.poll(() => connections).toBe(2)
  await page.keyboard.type("again")
  await expect.poll(() => inputs.join("")).toContain("again")
  expect(creates).toBe(0)
  expect(workspace.pty.created).toHaveLength(0)
  const added = { ...info, id: "pty_other", title: "TUI shell" }
  list.push(added)
  await workspace.push([
    {
      id: "evt_terminal_added",
      created: Date.now(),
      type: "persistent-pty.added",
      data: { sessionID, terminal: added },
    },
  ])
  await expect(page.getByRole("tab", { name: "TUI shell" })).toBeVisible()
})

test("does not fall back to a new legacy shell when the persistent terminal service is unavailable", async ({
  page,
}) => {
  const workspace = await mockWorkspace(page, { name: "UnavailableTerminal", pty: {} })
  await page.route(/\/api\/experimental\/session\/[^/]+\/terminal(?:\?.*)?$/, (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    }
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers })
    return route.fulfill({
      status: 503,
      headers,
      json: { _tag: "ServiceUnavailableError", message: "PTY unavailable" },
    })
  })
  await page.goto(sessionHref(workspace.sessions[0]!.id))
  await expectSessionTitle(page, "UnavailableTerminal")
  await page.keyboard.press("Control+Backquote")
  const alert = page.locator("#terminal-panel").getByRole("alert")
  await expect(alert).toContainText("PTY unavailable")
  await alert.getByRole("button", { name: "Try again" }).click()
  await expect(alert).toContainText("PTY unavailable")
  expect(workspace.pty.created).toHaveLength(0)
})

test("keeps existing workspace terminals when session terminals are available", async ({ page }) => {
  const old = { id: "pty_old", title: "Old shell", titleNumber: 1 }
  const workspace = await mockWorkspace(page, {
    name: "MixedTerminals",
    pty: { initial: [old] },
    seed: { storage: { [legacyTerminalKey("C:/OpenCode/MixedTerminals")]: { active: old.id, all: [old] } } },
  })
  const sessionID = workspace.sessions[0]!.id
  await page.route(/\/api\/experimental\/session\/[^/]+\/terminal(?:\?.*)?$/, (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, OPTIONS",
    }
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers })
    return route.fulfill({
      headers,
      json: {
        data: [
          {
            id: "pty_shared",
            sessionID,
            title: "Shared shell",
            command: "cmd.exe",
            args: [],
            cwd: workspace.directory,
            pid: 42,
            status: "running",
            foregroundProcess: null,
            size: { cols: 80, rows: 24 },
            output: { head: 0, tail: 0 },
          },
        ],
      },
    })
  })
  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, "MixedTerminals")
  await page.keyboard.press("Control+Backquote")
  await expect(page.getByRole("tab", { name: "Old shell" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Shared shell" })).toBeVisible()
  expect(workspace.pty.created).toHaveLength(0)
})

test("waits for server capability discovery before creating a new terminal", async ({ page }) => {
  const old = { id: "pty_old", title: "Old shell", titleNumber: 1 }
  const workspace = await mockWorkspace(page, {
    name: "TerminalDiscovery",
    pty: { initial: [old] },
    seed: { storage: { [legacyTerminalKey("C:/OpenCode/TerminalDiscovery")]: { active: old.id, all: [old] } } },
  })
  const sessionID = workspace.sessions[0]!.id
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const created: string[] = []
  const info = {
    id: "pty_new",
    sessionID,
    title: "New shared shell",
    command: "cmd.exe",
    args: [],
    cwd: workspace.directory,
    pid: 42,
    status: "running",
    foregroundProcess: null,
    size: { cols: 80, rows: 24 },
    output: { head: 0, tail: 0 },
  }
  await page.route(/\/api\/experimental\/session\/[^/]+\/terminal(?:\?.*)?$/, async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    }
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers })
    if (route.request().method() === "POST") {
      created.push("persistent")
      return route.fulfill({ headers, json: { data: info } })
    }
    entered.resolve()
    await release.promise
    return route.fulfill({ headers, json: { data: [] } })
  })
  await page.goto(sessionHref(sessionID))
  try {
    await expectSessionTitle(page, "TerminalDiscovery")
    await entered.promise
    await page.keyboard.press("Control+Alt+t")
    // Let the key handler run while capability discovery is still held.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    release.resolve()
    await expect.poll(() => created.length).toBe(1)
    expect(workspace.pty.created).toHaveLength(0)
  } finally {
    release.resolve()
  }
})

test("keeps the same legacy terminal when switching sessions in one workspace", async ({ page }) => {
  const sessions = [
    { id: "ses_legacy_a", title: "Legacy A" },
    { id: "ses_legacy_b", title: "Legacy B" },
  ]
  const workspace = await openSession(page, { name: "LegacySwitch", sessions, pty: {} })
  await page.keyboard.press("Control+Backquote")
  const terminal = page.locator('[data-component="terminal"]')
  await expect(terminal).toBeVisible()
  await expect.poll(() => workspace.pty.sockets.length).toBe(1)
  await terminal.evaluate((element) => element.setAttribute("data-test-original", "yes"))
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Legacy B" }).click()
  await expectSessionTitle(page, "Legacy B")
  await expect(terminal).toHaveCount(1)
  await page.keyboard.press("Control+Backquote")
  await expect(terminal).toBeVisible()
  await expect(terminal).toHaveAttribute("data-test-original", "yes")
  expect(workspace.pty.sockets).toHaveLength(1)
  expect(workspace.pty.created).toHaveLength(1)
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Legacy A" }).click()
  await expectSessionTitle(page, "Legacy A")
  await expect(terminal).toHaveAttribute("data-test-original", "yes")
})

test("keeps persistent terminals isolated by session in the same workspace", async ({ page }) => {
  const sessions = [
    { id: "ses_persistent_a", title: "Persistent A" },
    { id: "ses_persistent_b", title: "Persistent B" },
  ]
  const workspace = await mockWorkspace(page, { name: "PersistentSwitch", sessions, pty: {} })
  const info = (sessionID: string) => ({
    id: `pty_${sessionID}`,
    sessionID,
    title: sessionID.endsWith("_a") ? "Shell A" : "Shell B",
    command: "cmd.exe",
    args: [],
    cwd: workspace.directory,
    pid: 42,
    status: "running",
    foregroundProcess: null,
    size: { cols: 80, rows: 24 },
    output: { head: 0, tail: 0 },
  })
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  }
  await page.route(
    /\/api\/experimental\/(?:session\/[^/]+\/terminal|persistent-pty\/[^/]+\/(?:snapshot|connect-token))(?:\?.*)?$/,
    (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers })
      const parts = new URL(route.request().url()).pathname.split("/")
      if (parts[3] === "session") return route.fulfill({ headers, json: { data: [info(parts[4]!)] } })
      const terminal = info(parts[4]!.slice("pty_".length))
      if (parts[5] === "snapshot")
        return route.fulfill({
          headers,
          json: {
            data: {
              info: terminal,
              text: "ready",
              checkpoint: Buffer.from("ready").toString("base64"),
              cursor: { x: 5, y: 0 },
            },
          },
        })
      return route.fulfill({ headers, json: { data: { ticket: "ticket", expires_in: 60 } } })
    },
  )
  const connections: string[] = []
  await page.routeWebSocket(/\/api\/experimental\/persistent-pty\/[^/]+\/connect\?/, (socket) => {
    const id = new URL(socket.url()).pathname.split("/")[4]!
    connections.push(id)
    socket.send(
      JSON.stringify({ type: "attached", inputProtocol: 1, role: "observer", info: info(id.slice("pty_".length)) }),
    )
    socket.send(JSON.stringify({ type: "replay_complete" }))
  })
  await page.goto(sessionHref(sessions[0]!.id))
  await expectSessionTitle(page, "Persistent A")
  await page.keyboard.press("Control+Backquote")
  await expect(page.getByRole("tab", { name: "Shell A" })).toBeVisible()
  await expect.poll(() => connections).toEqual(["pty_ses_persistent_a"])
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Persistent B" }).click()
  await expectSessionTitle(page, "Persistent B")
  await page.keyboard.press("Control+Backquote")
  await expect(page.getByRole("tab", { name: "Shell B" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Shell A" })).toHaveCount(0)
  await expect.poll(() => connections.length).toBe(2)
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Persistent A" }).click()
  await expectSessionTitle(page, "Persistent A")
  await expect(page.getByRole("tab", { name: "Shell A" })).toBeVisible()
  expect(connections).toEqual(["pty_ses_persistent_a", "pty_ses_persistent_b"])
  expect(workspace.pty.created).toHaveLength(0)
})

test("shows terminal creation failures and retries without losing existing tabs", async ({ page }) => {
  const { pty } = await openSession(page, workspace)
  const failure = { next: true }
  await page.route(/\/api\/pty\?/, (route) => {
    if (route.request().method() !== "POST" || !failure.next) return route.fallback()
    failure.next = false
    return route.fulfill({
      status: 500,
      headers: { "access-control-allow-origin": "*" },
      body: "Internal Server Error",
    })
  })

  await page.keyboard.press("Control+Backquote")
  const panel = page.locator("#terminal-panel")
  const toolbar = page.locator('[data-slot="terminal-tabs-toolbar"]')
  const alert = panel.getByRole("alert")
  await expect(alert).toContainText("Could not create terminal")
  expect(pty.created).toEqual([])
  await alert.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(alert).toHaveCount(0)
  await expect(toolbar.getByRole("tab", { name: "Terminal 1", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => pty.sockets.length).toBe(1)
  const original = pty.created[0]!.id

  failure.next = true
  await toolbar.getByRole("button", { name: "New terminal", exact: true }).click()
  await expect(alert).toContainText("Could not create terminal")
  await expect(toolbar.getByRole("tab", { name: "Terminal 1", exact: true })).toHaveAttribute("aria-selected", "true")
  expect(pty.created.map((item) => item.id)).toEqual([original])
  await alert.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(alert).toHaveCount(0)
  await expect(toolbar.getByRole("tab", { name: "Terminal 2", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => pty.sockets.length).toBe(2)
  expect(pty.created.map((item) => item.id)).toEqual([original, "pty_2"])
  expect(pty.removed).toEqual([])
})

test("clears the terminal line with Command+Delete", async ({ page }) => {
  const { pty } = await openSession(page, workspace)
  const terminal = page.locator('[data-component="terminal"]')
  await page.keyboard.press("Control+Backquote")
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await expect.poll(() => pty.sockets.length).toBe(1)

  await page.keyboard.press("Meta+Backspace")
  await expect.poll(() => pty.sockets[0]!.input.join("")).toBe("\x15")
})

test("reveals the terminal after its first output and hides the native caret", async ({ page }) => {
  const { pty } = await openSession(page, workspace)
  await page.keyboard.press("Control+Backquote")
  const terminal = page.locator('[data-component="terminal"]')
  await expect(terminal).toHaveAttribute("contenteditable", "true")
  await expect(terminal).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)")
  await expect(terminal).toHaveCSS("opacity", "0")
  await expect.poll(() => pty.sockets.length).toBe(1)

  pty.send("\x1b[?25h")
  await expect(terminal).toHaveCSS("opacity", "0")
  pty.send("ready")
  await expect(terminal).toHaveCSS("opacity", "1")
})

test("routes typing to the composer unless the open terminal is focused", async ({ page }) => {
  const { pty, editor } = await openSession(page, workspace)
  const terminal = page.locator('[data-component="terminal"]')
  await editor.click()
  await expect(editor).toBeFocused()
  await page.keyboard.press("Control+Backquote")
  await expect(terminal).toBeVisible()
  await expect.poll(() => terminal.evaluate((element) => element.contains(document.activeElement))).toBe(true)

  await page.keyboard.type("x")
  await expect(editor).toHaveText("")
  await expect.poll(() => pty.sockets.length).toBe(1)
  pty.send("ready")
  await expect(terminal).toHaveCSS("opacity", "1")
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.keyboard.type("a")
  await expect(editor).toBeFocused()
  await expect(editor).toHaveText("a")
})

for (const mount of ["cached", "explicit"] as const) {
  test(`keeps newer composer focus while a ${mount} terminal finishes mounting`, async ({ page }) => {
    const ghostty = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    await page.route(/ghostty-web/, async (route) => {
      ghostty.resolve()
      await release.promise
      await route.continue()
    })
    const cached = { id: "pty_cached", title: "Terminal 1" }

    const { pty, sessions } = await mockWorkspace(page, {
      ...workspace,
      pty: mount === "cached" ? { initial: [cached] } : {},
      seed:
        mount === "cached"
          ? {
              panes: { ses_terminalinput: { terminal: true, terminalHeight: 320 } },
              // The pre-extension terminal store, which the terminal extension imports.
              storage: { [legacyTerminalKey()]: { active: cached.id, all: [{ ...cached, titleNumber: 1 }] } },
            }
          : undefined,
    })

    await page.goto(sessionHref(sessions[0]!.id), { waitUntil: "commit" })
    await expectSessionTitle(page, "TerminalInput")
    const editor = page.locator('[data-component="composer-editor"]')
    const terminal = page.locator('[data-component="terminal"]')

    if (mount === "explicit") {
      await expect(editor).toBeEditable()
      await page.keyboard.press("Control+Backquote")
    }

    await expect(terminal).toBeVisible()
    await ghostty.promise
    await editor.click()
    await expect(editor).toBeFocused()

    release.resolve()
    await expect(terminal.locator("textarea")).toHaveCount(1)
    await expect.poll(() => pty.sockets.length).toBe(1)
    pty.send("ready")
    await expect(terminal).toHaveCSS("opacity", "1")
    await expect(editor).toBeFocused()

    if (mount === "cached") expect(pty.created).toEqual([])
  })
}

test("reconnects the same terminal after a transient connection failure", async ({ page }) => {
  const { pty } = await openSession(page, workspace)
  let tickets = 0
  await page.route(/\/api\/pty\/[^/]+\/connect-token/, (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback()
    tickets += 1

    if (tickets !== 2) return route.fallback()

    return route.fulfill({
      status: 503,
      headers: { "access-control-allow-origin": "*" },
      body: "Service Unavailable",
    })
  })
  await page.keyboard.press("Control+Backquote")
  const terminal = page.locator('[data-component="terminal"]')
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await expect.poll(() => pty.sockets.length).toBe(1)
  const id = pty.sockets[0]!.id
  await terminal.evaluate((element) => element.setAttribute("data-connection-probe", "original"))

  await pty.sockets[0]!.close(1011, "Temporary disconnection")
  await expect.poll(() => tickets).toBe(3)
  await expect.poll(() => pty.sockets.length).toBe(2)
  expect(pty.sockets[1]!.id).toBe(id)
  expect(pty.rejected).toEqual([])
  await expect(terminal).toHaveAttribute("data-connection-probe", "original")
  expect(pty.created.map((item) => item.id)).toEqual([id])
})

test("does not create a second shell when the terminal renderer fails to load", async ({ page }) => {
  const { pty } = await openSession(page, workspace)
  await page.route(/ghostty-web/, (route) => route.abort("failed"))
  await page.keyboard.press("Control+Backquote")
  await expect.poll(() => pty.created.length).toBe(1)
  const toast = page.getByText("Connection Lost", { exact: true })
  await expect(toast).toBeVisible()
  await page.waitForLoadState("networkidle")
  expect(pty.created).toHaveLength(1)
})

test("reconnects without skipping output that exceeded the terminal rendering budget", async ({ page }) => {
  const { pty } = await openSession(page, workspace)
  await page.keyboard.press("Control+Backquote")
  const terminal = page.locator('[data-component="terminal"]')
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await expect.poll(() => pty.sockets.length).toBe(1)
  const id = pty.sockets[0]!.id
  pty.send("ready")
  await expect(terminal).toHaveCSS("opacity", "1")

  pty.send("x".repeat(4 * 1024 * 1024 + 1))
  await expect.poll(() => pty.sockets.length).toBe(2)
  expect(pty.sockets[0]!.closed).toBe(true)
  expect(pty.sockets[1]!.id).toBe(id)
  expect(pty.sockets[1]!.url.searchParams.get("cursor")).toBe("5")
  expect(pty.created.map((item) => item.id)).toEqual([id])
  pty.send("resumed")
  await terminal.locator("textarea").focus()
  await page.keyboard.type("pwd")
  await expect.poll(() => pty.sockets[1]!.input.join("")).toBe("pwd")
})

test("focuses a terminal created from the new-terminal button", async ({ page }) => {
  const { editor } = await openSession(page, workspace)
  const terminal = page.locator('[data-component="terminal"]')
  await page.keyboard.press("Control+Backquote")
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await editor.click()
  await expect(editor).toBeFocused()

  await page.getByRole("button", { name: "New terminal" }).click()
  await expect(page.getByRole("tab", { name: "Terminal 2" })).toHaveAttribute("aria-selected", "true")
  const active = page.locator('#terminal-wrapper-pty_2 [data-component="terminal"]')
  await expect.poll(() => active.evaluate((element) => element.contains(document.activeElement))).toBe(true)
})

test("closing the last restored terminal does not create a hidden replacement", async ({ page }) => {
  const cached = { id: "pty_cached", title: "Terminal 1" }

  const { pty } = await openSession(page, {
    ...workspace,
    pty: { initial: [cached] },
    seed: {
      panes: { ses_terminalinput: { terminal: true, terminalHeight: 320 } },
      storage: { [legacyTerminalKey()]: { active: cached.id, all: [{ ...cached, titleNumber: 1 }] } },
    },
  })

  const terminal = page.locator('[data-component="terminal"]')
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await expect.poll(() => pty.sockets.length).toBe(1)
  expect(pty.created).toEqual([])

  await page
    .locator('[data-slot="terminal-tabs-toolbar"]')
    .getByRole("button", { name: "Close terminal", exact: true })
    .click()
  await expect(terminal).toBeHidden()
  await expect.poll(() => pty.removed).toEqual([cached.id])
  expect(pty.created).toEqual([])

  await page.keyboard.press("Control+Backquote")
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await expect.poll(() => pty.created.map((item) => item.id)).toEqual(["pty_1"])
  await expect(
    page.locator('[data-slot="terminal-tabs-toolbar"]').getByRole("tab", { name: "Terminal 1", exact: true }),
  ).toHaveAttribute("aria-selected", "true")
})

function legacyTerminalKey(directory = "C:/OpenCode/TerminalInput") {
  const dir = base64Encode(directory)
  const head = dir.slice(0, 12).replace(/[^a-zA-Z0-9._-]/g, "-")

  return `opencode.workspace.${head}.${checksum(dir) ?? "0"}.dat:workspace:terminal`
}
