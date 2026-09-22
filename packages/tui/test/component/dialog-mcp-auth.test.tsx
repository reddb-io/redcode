/** @jsxImportSource @opentui/solid */
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { useRenderer } from "@opentui/solid"
import { describe, expect, test } from "bun:test"
import { onCleanup, onMount, type JSX } from "solid-js"
import type { McpServerInfo, McpStatus } from "@reddb-io/redcode-sdk/v2"
import { DialogMcp, authLabel } from "../../src/component/dialog-mcp"
import { DialogMcpAuth, isSigningIn, parseAuthorizationInput } from "../../src/component/dialog-mcp-auth"
import { McpAuthPrompt } from "../../src/component/mcp-auth-prompt"
import { openMcpAuth, useMcpAuthPrompts } from "../../src/component/mcp-auth-watch"
import { ClipboardProvider } from "../../src/context/clipboard"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider, useToast, type ToastOptions } from "../../src/ui/toast"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { tmpdir } from "../fixture/fixture"
import { mount, wait, json } from "../cli/cmd/tui/sync-fixture"

const AUTH_URL = "https://auth.example/authorize?client_id=redcode&state=state-1"

type Toasts = Array<{ title?: string; message: string; action?: ToastOptions["action"] }>

function Harness(props: { open?: () => JSX.Element; toasts?: Toasts; prompts?: boolean; copied?: string[] }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  function Probe() {
    const dialog = useDialog()
    const toast = useToast()
    const show = toast.show
    toast.show = (options) => {
      props.toasts?.push({ title: options.title, message: options.message, action: options.action })
      show(options)
    }
    if (props.prompts) useMcpAuthPrompts()
    onMount(() => {
      if (props.open) dialog.replace(props.open)
    })
    return null
  }
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={config}>
        <ThemeProvider mode="dark">
          <ClipboardProvider value={{ write: async (text) => void props.copied?.push(text) }}>
            <ToastProvider>
              <DialogProvider>
                <Probe />
              </DialogProvider>
            </ToastProvider>
          </ClipboardProvider>
        </ThemeProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

type Server = {
  states: Record<string, McpStatus>
  info?: Record<string, McpServerInfo>
  /** Answers for successive /auth/wait calls; the last one repeats. */
  waits?: Array<McpStatus | { status: "pending" } | (() => Promise<Response>)>
  callback?: McpStatus | (() => Promise<Response>)
  authorizationUrl?: string
  /** False: the server reports that its callback listener could not start. */
  listening?: boolean
}

function fakeServer(server: Server) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = []
  let waitIndex = 0
  let attempts = 0
  const handler = async (url: URL, input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : undefined
    const method = request?.method ?? "GET"
    const path = url.pathname
    if (!path.startsWith("/mcp") && path !== "/experimental/resource") return undefined
    const text = request && method !== "GET" ? await request.clone().text() : ""
    calls.push({ method, path, body: text ? JSON.parse(text) : undefined })
    if (path === "/mcp") return json(server.states)
    if (path === "/mcp/info") return json(server.info ?? {})
    if (path === "/experimental/resource") return json({})
    const match = /^\/mcp\/([^/]+)\/(auth(?:\/\w+)?|connect|disconnect)$/.exec(path)
    const name = match?.[1] ?? ""
    switch (`${method} ${match?.[2]}`) {
      case "POST auth":
        attempts++
        return json({
          authorizationUrl: server.authorizationUrl ?? AUTH_URL,
          oauthState: `state-${attempts}`,
          listening: server.listening ?? true,
          redirectUri: "http://127.0.0.1:40123/mcp/oauth/callback",
        })
      case "POST auth/wait": {
        const answers = server.waits ?? [{ status: "pending" }]
        const answer = answers[Math.min(waitIndex++, answers.length - 1)]
        if (typeof answer === "function") return answer()
        if (answer.status === "connected") server.states[name] = answer
        return json(answer)
      }
      case "POST auth/callback": {
        if (typeof server.callback === "function") return server.callback()
        const status = server.callback ?? { status: "connected" }
        if (status.status === "connected") server.states[name] = status
        return json(status)
      }
      case "POST auth/cancel":
        return json({ success: true })
      case "DELETE auth":
        return json({ success: true })
    }
    if (path === "/mcp/reload") {
      for (const key of Object.keys(server.states)) server.states[key] = { status: "needs_auth" }
      return json(server.states)
    }
    return undefined
  }
  return {
    calls,
    handler,
    count: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path).length,
  }
}

async function setupDialog(
  server: Server,
  open: () => JSX.Element,
  extra: { toasts?: Toasts; prompts?: boolean; copied?: string[] } = {},
) {
  const tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const fake = fakeServer(server)
  const setup = await mount(fake.handler, tmp.path, () => <Harness open={open} {...extra} />, {
    width: 100,
    height: 40,
  })
  return {
    ...setup,
    fake,
    frame: async () => {
      await setup.app.renderOnce()
      return setup.app.captureCharFrame()
    },
    async [Symbol.asyncDispose]() {
      setup.app.renderer.destroy()
      await tmp[Symbol.asyncDispose]()
    },
  }
}

describe("MCP servers dialog", () => {
  test("lists status, tool count and auth state for each server", async () => {
    const hour = Date.now() / 1000 + 3 * 3600
    await using setup = await setupDialog(
      {
        states: {
          docs: { status: "connected" },
          linear: { status: "needs_auth" },
          local: { status: "disabled" },
          broken: { status: "failed", error: "spawn ENOENT" },
          corp: { status: "needs_client_registration", error: "Provide clientId" },
        },
        info: {
          docs: { type: "remote", tools: 12, oauth: true, auth: "authenticated", expiresAt: hour },
          linear: { type: "remote", tools: 0, oauth: true, auth: "expired" },
          local: { type: "local", tools: 0, oauth: false },
          broken: { type: "local", tools: 0, oauth: false },
          corp: { type: "remote", tools: 0, oauth: true, auth: "not_authenticated" },
        },
      },
      () => <DialogMcp />,
    )
    await wait(() => setup.fake.count("GET", "/mcp/info") === 1)
    await wait(() => setup.app.captureCharFrame().includes("12 tools"))
    const frame = await setup.frame()
    expect(frame).toContain("MCP servers")
    expect(frame).toContain("connected · 12 tools · signed in, expires in 3h")
    expect(frame).toContain("needs auth · token expired")
    expect(frame).toContain("disabled")
    expect(frame).toContain("spawn ENOENT")
    expect(frame).toContain("Provide clientId · not signed in")
    expect(frame).toContain("⚠ Sign in")
  })

  test("authenticate calls the start route, opens the browser once and refreshes status on success", async () => {
    const opened: string[] = []
    const server: Server = {
      states: { linear: { status: "needs_auth" } },
      info: { linear: { type: "remote", tools: 0, oauth: true, auth: "not_authenticated" } },
      waits: [{ status: "pending" }, { status: "pending" }, { status: "connected" }],
    }
    await using setup = await setupDialog(server, () => <DialogMcp opener={async (url) => void opened.push(url)} />)
    await wait(() => setup.app.renderer.currentFocusedRenderable instanceof InputRenderable)
    await wait(() => setup.fake.count("GET", "/mcp/info") === 1)
    setup.app.mockInput.pressKey("a", { ctrl: true })
    await wait(() => setup.sync.data.mcp.linear?.status === "connected")
    expect(setup.fake.count("POST", "/mcp/linear/auth")).toBe(1)
    expect(setup.fake.count("POST", "/mcp/linear/auth/wait")).toBe(3)
    expect(setup.fake.calls.find((c) => c.path === "/mcp/linear/auth/wait")?.body).toMatchObject({
      oauthState: "state-1",
    })
    expect(opened).toEqual([AUTH_URL])
    // Back on the server list, which reloads its details.
    await wait(() => setup.fake.count("GET", "/mcp/info") === 2)
    expect(setup.fake.count("POST", "/mcp/linear/auth/cancel")).toBe(0)
    expect(setup.fake.count("POST", "/mcp/linear/auth/authenticate")).toBe(0)
    expect(await setup.frame()).toContain("MCP servers")
  })

  test("a browser that cannot open leaves the URL on screen and accepts a pasted redirect", async () => {
    let opens = 0
    const copied: string[] = []
    const server: Server = { states: { linear: { status: "needs_auth" } } }
    await using setup = await setupDialog(
      server,
      () => (
        <DialogMcpAuth
          name="linear"
          opener={async () => {
            opens++
            throw new Error("xdg-open not found")
          }}
        />
      ),
      { copied },
    )
    await wait(() => setup.app.renderer.currentFocusedRenderable instanceof TextareaRenderable)
    let frame = await setup.frame()
    expect(opens).toBe(1)
    expect(frame).toContain("Could not open a browser here (xdg-open not found)")
    expect(frame).toContain("https://auth.example/authorize")
    expect(frame).toContain("http://127.0.0.1:40123/mcp/oauth/callback?code=…&state=…")

    setup.app.mockInput.pressKey("y", { ctrl: true })
    await wait(() => copied.length === 1)
    expect(copied).toEqual([AUTH_URL])

    const textarea = setup.app.renderer.currentFocusedRenderable as TextareaRenderable
    textarea.setText("http://127.0.0.1:40123/mcp/oauth/callback?code=abc")
    setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("no state parameter"))

    textarea.setText("http://127.0.0.1:40123/mcp/oauth/callback?code=abc&state=other")
    setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("different sign-in attempt"))
    expect(setup.fake.count("POST", "/mcp/linear/auth/callback")).toBe(0)

    textarea.setText("http://127.0.0.1:40123/mcp/oauth/callback?code=abc&state=state-1")
    setup.app.mockInput.pressEnter()
    await wait(() => setup.sync.data.mcp.linear?.status === "connected")
    expect(setup.fake.calls.find((c) => c.path === "/mcp/linear/auth/callback")?.body).toEqual({
      code: "abc",
      oauthState: "state-1",
    })
    expect(opens).toBe(1)
    frame = await setup.frame()
    expect(frame).not.toContain("Authenticate linear")
  })

  test("closing the dialog while waiting cancels the attempt", async () => {
    let opens = 0
    const gate = Promise.withResolvers<Response>()
    await using setup = await setupDialog(
      { states: { linear: { status: "needs_auth" } }, waits: [() => gate.promise] },
      () => <DialogMcpAuth name="linear" opener={async () => void opens++} />,
    )
    await wait(() => setup.fake.count("POST", "/mcp/linear/auth/wait") === 1)
    setup.app.mockInput.pressEscape()
    await wait(() => setup.fake.count("POST", "/mcp/linear/auth/cancel") === 1)
    // The cancel names its own attempt, so it cannot end one that replaced it.
    expect(setup.fake.calls.find((c) => c.path === "/mcp/linear/auth/cancel")?.body).toEqual({ oauthState: "state-1" })
    gate.resolve(json({ status: "pending" }))
    expect(opens).toBe(1)
    expect(await setup.frame()).not.toContain("Authenticate linear")
  })

  test("times out, cancels the attempt and offers a retry that opens the browser once more", async () => {
    let opens = 0
    await using setup = await setupDialog(
      {
        states: { linear: { status: "needs_auth" } },
        waits: [{ status: "pending" }],
      },
      () => <DialogMcpAuth name="linear" timeoutMs={150} opener={async () => void opens++} />,
    )
    await wait(() => setup.app.captureCharFrame().includes("Timed out waiting for approval"))
    expect(setup.fake.count("POST", "/mcp/linear/auth/cancel")).toBe(1)
    expect(opens).toBe(1)
    setup.app.mockInput.pressKey("r", { ctrl: true })
    await wait(() => setup.fake.count("POST", "/mcp/linear/auth") === 2)
    await wait(() => opens === 2)
  })

  test("a second trigger does not replace a sign-in already on screen", async () => {
    let opens = 0
    await using setup = await setupDialog({ states: { linear: { status: "needs_auth" } } }, () => (
      <DialogMcpAuth name="linear" opener={async () => void opens++} />
    ))
    await wait(() => setup.fake.count("POST", "/mcp/linear/auth/wait") >= 1)
    expect(isSigningIn("linear")).toBe(true)
    const replaced: unknown[] = []
    expect(openMcpAuth({ replace: (element: unknown) => void replaced.push(element) }, "linear")).toBe(false)
    expect(replaced).toHaveLength(0)
    expect(setup.fake.count("POST", "/mcp/linear/auth")).toBe(1)
    expect(opens).toBe(1)
  })

  test("esc while a pasted code is exchanged does not cancel the attempt", async () => {
    const gate = Promise.withResolvers<Response>()
    await using setup = await setupDialog(
      { states: { linear: { status: "needs_auth" } }, callback: () => gate.promise },
      () => <DialogMcpAuth name="linear" opener={async () => {}} />,
    )
    await wait(() => setup.app.renderer.currentFocusedRenderable instanceof TextareaRenderable)
    const textarea = setup.app.renderer.currentFocusedRenderable as TextareaRenderable
    textarea.setText("abc")
    setup.app.mockInput.pressEnter()
    await wait(() => setup.fake.count("POST", "/mcp/linear/auth/callback") === 1)
    setup.app.mockInput.pressEscape()
    await wait(() => !setup.app.captureCharFrame().includes("Authenticate linear"))
    gate.resolve(json({ status: "connected" }))
    expect(setup.fake.count("POST", "/mcp/linear/auth/cancel")).toBe(0)
  })

  test("keeps waiting through transient poll failures", async () => {
    await using setup = await setupDialog(
      {
        states: { linear: { status: "needs_auth" } },
        waits: [
          async () => new Response("bad gateway", { status: 502 }),
          async () => {
            throw new TypeError("fetch failed")
          },
          { status: "connected" },
        ],
      },
      () => <DialogMcpAuth name="linear" opener={async () => {}} />,
    )
    await wait(() => setup.sync.data.mcp.linear?.status === "connected", 5_000)
    expect(setup.fake.count("POST", "/mcp/linear/auth/wait")).toBe(3)
    expect(setup.fake.count("POST", "/mcp/linear/auth/cancel")).toBe(0)
  })

  test("goes straight to paste mode when the server cannot receive the callback", async () => {
    await using setup = await setupDialog({ states: { linear: { status: "needs_auth" } }, listening: false }, () => (
      <DialogMcpAuth name="linear" opener={async () => {}} />
    ))
    await wait(() => setup.app.captureCharFrame().includes("callback port is in use"))
    expect(setup.fake.count("POST", "/mcp/linear/auth/wait")).toBe(0)
    // The textarea takes focus after the frame shows the message; wait for it.
    await wait(() => setup.app.renderer.currentFocusedRenderable instanceof TextareaRenderable)
    const textarea = setup.app.renderer.currentFocusedRenderable as TextareaRenderable
    textarea.setText("http://127.0.0.1:40123/mcp/oauth/callback?code=abc&state=state-1")
    setup.app.mockInput.pressEnter()
    await wait(() => setup.sync.data.mcp.linear?.status === "connected")
    expect(setup.fake.count("POST", "/mcp/linear/auth/wait")).toBe(0)
  })

  test("log out asks for confirmation before removing credentials", async () => {
    const server: Server = {
      states: { linear: { status: "connected" } },
      info: { linear: { type: "remote", tools: 3, oauth: true, auth: "authenticated" } },
    }
    await using setup = await setupDialog(server, () => <DialogMcp />)
    await wait(() => setup.fake.count("GET", "/mcp/info") === 1)
    await wait(() => setup.app.captureCharFrame().includes("3 tools"))

    setup.app.mockInput.pressKey("d", { ctrl: true })
    await wait(() => setup.app.captureCharFrame().includes("Log out of linear?"))
    expect(setup.fake.count("DELETE", "/mcp/linear/auth")).toBe(0)
    // Cancel first: nothing is removed.
    setup.app.mockInput.pressArrow("left")
    setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("MCP servers"))
    expect(setup.fake.count("DELETE", "/mcp/linear/auth")).toBe(0)

    await wait(() => setup.app.renderer.currentFocusedRenderable instanceof InputRenderable)
    setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Re-authenticate"))
    const frame = await setup.frame()
    expect(frame).toContain("Reconnect")
    expect(frame).toContain("Disable")
    setup.app.mockInput.pressArrow("down")
    setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Log out of linear?"))
    setup.app.mockInput.pressEnter()
    await wait(() => setup.fake.count("DELETE", "/mcp/linear/auth") === 1)
    await wait(() => setup.sync.data.mcp.linear?.status === "needs_auth")
    expect(setup.fake.calls.find((c) => c.path === "/mcp/reload")?.body).toEqual({ name: "linear" })
  })
})

describe("MCP sign-in prompts", () => {
  test("toasts once per transition into needs_auth and the action opens the flow", async () => {
    const toasts: Toasts = []
    await using setup = await setupDialog({ states: { notion: { status: "needs_auth" } } }, undefined as never, {
      toasts,
      prompts: true,
    })
    await wait(() => toasts.length === 1)
    expect(toasts[0]).toMatchObject({ title: "MCP sign-in needed", action: { label: "Authenticate" } })
    expect(toasts[0].message).toContain("notion needs authentication")

    setup.sync.set("mcp", { notion: { status: "needs_auth" } })
    setup.sync.set("mcp", { notion: { status: "needs_auth" }, other: { status: "connected" } })
    // Disabling and enabling again is not a new transition.
    setup.sync.set("mcp", { notion: { status: "disabled" }, other: { status: "connected" } })
    setup.sync.set("mcp", { notion: { status: "needs_auth" }, other: { status: "connected" } })
    expect(toasts).toHaveLength(1)

    setup.sync.set("mcp", { notion: { status: "connected" }, other: { status: "connected" } })
    setup.sync.set("mcp", { notion: { status: "needs_auth" }, other: { status: "connected" } })
    await wait(() => toasts.length === 2)

    toasts[1].action!.run()
    await wait(() => setup.fake.count("POST", "/mcp/notion/auth") === 1)
    await wait(() => setup.app.captureCharFrame().includes("REDCODE_NO_BROWSER is set"))
    expect(await setup.frame()).toContain("Authenticate notion")
  })

  test("tracker reports each server once per transition, per workspace", () => {
    const track = McpAuthPrompt.createTracker()
    expect(track({ a: { status: "needs_auth" }, b: { status: "connected" } }, "w1")).toEqual(["a"])
    expect(track({ a: { status: "needs_auth" }, b: { status: "connected" } }, "w1")).toEqual([])
    expect(track({ a: { status: "failed" }, b: { status: "needs_auth" } }, "w1")).toEqual(["b"])
    expect(track({ a: { status: "needs_auth" }, b: { status: "needs_auth" } }, "w1")).toEqual(["a"])
    expect(track({ a: { status: "disabled" } }, "w1")).toEqual([])
    expect(track({ a: { status: "needs_auth" } }, "w1")).toEqual([])
    // Another workspace with a server of the same name is tracked on its own.
    expect(track({ a: { status: "needs_auth" } }, "w2")).toEqual(["a"])
  })

  test("acknowledged log outs are skipped once, per workspace, and never swallow a later transition", () => {
    const track = McpAuthPrompt.createTracker()
    track({ c: { status: "connected" }, e: { status: "needs_auth" } }, "w1", 0)
    McpAuthPrompt.acknowledge("w1", "c", 0)
    expect(track({ c: { status: "needs_auth" } }, "w2", 1)).toEqual(["c"])
    expect(track({ c: { status: "needs_auth" } }, "w1", 1)).toEqual([])
    expect(track({ c: { status: "connected" } }, "w1", 2)).toEqual([])
    expect(track({ c: { status: "needs_auth" } }, "w1", 3)).toEqual(["c"])

    // Logging out of a server that already needed auth: the next needs_auth snapshot settles it.
    McpAuthPrompt.acknowledge("w1", "e", 10)
    expect(track({ e: { status: "needs_auth" } }, "w1", 11)).toEqual([])
    expect(track({ e: { status: "connected" } }, "w1", 12)).toEqual([])
    expect(track({ e: { status: "needs_auth" } }, "w1", 13)).toEqual(["e"])

    McpAuthPrompt.acknowledge("w1", "d", 0)
    expect(track({ d: { status: "needs_auth" } }, "w1", 60_000)).toEqual(["d"])
  })
})

describe("pasted authorization input", () => {
  test("reads redirect URLs, bare codes and provider errors", () => {
    expect(parseAuthorizationInput("http://127.0.0.1:19876/mcp/oauth/callback?code=abc&state=s1")).toEqual({
      code: "abc",
      state: "s1",
      fromUrl: true,
    })
    expect(parseAuthorizationInput("  abc-123  ")).toEqual({ code: "abc-123", fromUrl: false })
    expect(parseAuthorizationInput("/mcp/oauth/callback?code=x")).toEqual({
      code: "x",
      state: undefined,
      fromUrl: true,
    })
    expect(
      parseAuthorizationInput("http://localhost/cb?error=access_denied&error_description=User%20said%20no"),
    ).toEqual({
      error: "User said no",
    })
    expect(parseAuthorizationInput("http://localhost/cb?state=only")).toBeUndefined()
    expect(parseAuthorizationInput("   ")).toBeUndefined()
  })

  test("auth labels show expiry when known", () => {
    const now = 1_000_000_000_000
    expect(authLabel({ type: "local", tools: 0, oauth: false }, now)).toBeUndefined()
    expect(authLabel({ type: "remote", tools: 0, oauth: true, auth: "authenticated" }, now)).toBe("signed in")
    expect(
      authLabel({ type: "remote", tools: 0, oauth: true, auth: "authenticated", expiresAt: now / 1000 + 600 }, now),
    ).toBe("signed in, expires in 10m")
    expect(
      authLabel(
        { type: "remote", tools: 0, oauth: true, auth: "authenticated", expiresAt: now / 1000 + 5 * 86400 },
        now,
      ),
    ).toBe("signed in, expires in 5d")
  })
})
