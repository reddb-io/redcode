import { TextareaRenderable, TextAttributes } from "@opentui/core"
import type { McpStatus } from "@reddb-io/redcode-sdk/v2"
import { Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js"
import { reconcile } from "solid-js/store"
import { useTuiConfig } from "../config"
import { useClipboard } from "../context/clipboard"
import { useProject } from "../context/project"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useBindings, useCommandShortcut } from "../keymap"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { openBrowser, type BrowserOpener, type BrowserOpenResult } from "../util/browser"
import { Spinner } from "./spinner"

/** Matches the server's callback listener timeout. */
export const MCP_AUTH_TIMEOUT_MS = 5 * 60 * 1000
const WAIT_SLICE_MS = 20_000
const MIN_POLL_INTERVAL_MS = 250

export type AuthorizationInput = { code: string; state?: string } | { error: string }

/**
 * Read what a user pasted after approving in a browser that could not reach the callback listener:
 * the full redirect URL (preferred, it carries the state) or the bare authorization code.
 */
export function parseAuthorizationInput(input: string): AuthorizationInput | undefined {
  const text = input.trim()
  if (!text) return undefined
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !text.includes("?")) return { code: text }
  let url: URL
  try {
    url = new URL(text, "http://localhost")
  } catch {
    return undefined
  }
  const params = new URLSearchParams(url.search || url.hash.replace(/^#/, ""))
  const error = params.get("error")
  if (error) return { error: params.get("error_description") ?? error }
  const code = params.get("code")
  if (!code) return undefined
  return { code, state: params.get("state") ?? undefined }
}

type Phase =
  | { type: "starting" }
  | { type: "waiting"; url: string; oauthState: string; browser: BrowserOpenResult }
  | { type: "finishing"; url: string; oauthState: string; browser: BrowserOpenResult }
  | { type: "failed"; error: string; url?: string }
  | { type: "timeout"; url: string }

export type DialogMcpAuthProps = {
  name: string
  /** Injected in tests; defaults to the system browser, which honours REDCODE_NO_BROWSER. */
  opener?: BrowserOpener
  timeoutMs?: number
  /** Called after the server reports `connected`; defaults to closing the dialog. */
  onDone?: (status: McpStatus) => void
}

/** Refresh MCP status and resources after an action changed a server outside the event stream. */
export async function refreshMcpState(
  sdk: ReturnType<typeof useSDK>,
  sync: ReturnType<typeof useSync>,
  workspace: string | undefined,
  signal?: AbortSignal,
) {
  const status = await sdk.client.mcp.status({ workspace }, { throwOnError: true, signal })
  if (signal?.aborted) return status.data
  sync.set("mcp", reconcile(status.data))
  const resources = await sdk.client.experimental.resource.list({ workspace }, { throwOnError: true, signal })
  if (!signal?.aborted) sync.set("mcp_resource", reconcile(resources.data))
  return status.data
}

export function DialogMcpAuth(props: DialogMcpAuthProps) {
  const sdk = useSDK()
  const sync = useSync()
  const project = useProject()
  const dialog = useDialog()
  const toast = useToast()
  const clipboard = useClipboard()
  const tuiConfig = useTuiConfig()
  const { theme } = useTheme()
  const submitShortcut = useCommandShortcut("dialog.prompt.submit")
  const copyShortcut = useCommandShortcut("dialog.mcp.auth.copy")
  const retryShortcut = useCommandShortcut("dialog.mcp.auth.retry")
  const [phase, setPhase] = createSignal<Phase>({ type: "starting" })
  const [remaining, setRemaining] = createSignal(props.timeoutMs ?? MCP_AUTH_TIMEOUT_MS)
  const [pasteError, setPasteError] = createSignal<string>()
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  const workspace = project.workspace.current()
  let attempt: { abort: AbortController; settled: boolean; oauthState?: string } | undefined
  let textarea: TextareaRenderable | undefined
  let ticker: ReturnType<typeof setInterval> | undefined

  const url = () => {
    const current = phase()
    return "url" in current ? current.url : undefined
  }

  function stopTicker() {
    if (ticker) clearInterval(ticker)
    ticker = undefined
  }

  function abandon() {
    const current = attempt
    attempt = undefined
    stopTicker()
    if (!current || current.settled) return
    current.settled = true
    current.abort.abort()
    // Release the server-side listener; stored credentials stay untouched.
    if (current.oauthState) void sdk.client.mcp.auth.cancel({ name: props.name, workspace }).catch(() => {})
  }

  async function finish(run: NonNullable<typeof attempt>, status: McpStatus) {
    if (run.settled) return
    run.settled = true
    stopTicker()
    await refreshMcpState(sdk, sync, workspace).catch(() => undefined)
    if (attempt !== run) return
    if (status.status === "connected") {
      toast.show({ variant: "success", message: `${props.name} is authenticated and connected.` })
      if (props.onDone) props.onDone(status)
      else dialog.clear()
      return
    }
    setPhase({
      type: "failed",
      url: url(),
      error:
        status.status === "failed" || status.status === "needs_client_registration"
          ? status.error
          : `The server is ${status.status.replaceAll("_", " ")} after signing in.`,
    })
  }

  async function start() {
    abandon()
    const run = { abort: new AbortController(), settled: false } as NonNullable<typeof attempt>
    attempt = run
    setPasteError(undefined)
    setPhase({ type: "starting" })
    try {
      const started = await sdk.client.mcp.auth.start(
        { name: props.name, workspace },
        { throwOnError: true, signal: run.abort.signal },
      )
      if (attempt !== run) return
      const { authorizationUrl, oauthState } = started.data
      if (!authorizationUrl) {
        // Stored credentials were still valid: the server reconnected without a browser round trip.
        const status = await sdk.client.mcp.status({ workspace }, { throwOnError: true, signal: run.abort.signal })
        return finish(run, status.data[props.name] ?? { status: "failed", error: "Server status is unavailable." })
      }
      run.oauthState = oauthState
      // Exactly one launch per attempt; the URL stays on screen for every other case.
      const browser = await openBrowser(authorizationUrl, props.opener)
      if (attempt !== run) return
      setPhase({ type: "waiting", url: authorizationUrl, oauthState, browser })
      const deadline = Date.now() + (props.timeoutMs ?? MCP_AUTH_TIMEOUT_MS)
      setRemaining(deadline - Date.now())
      ticker = setInterval(() => setRemaining(Math.max(0, deadline - Date.now())), 1000)
      while (attempt === run && !run.settled) {
        const left = deadline - Date.now()
        if (left <= 0) {
          abandon()
          setPhase({ type: "timeout", url: authorizationUrl })
          return
        }
        const asked = Date.now()
        const result = await sdk.client.mcp.auth.wait(
          { name: props.name, workspace, oauthState, waitMs: Math.min(WAIT_SLICE_MS, left) },
          { throwOnError: true, signal: run.abort.signal },
        )
        if (attempt !== run || run.settled) return
        if (result.data.status === "pending") {
          // A server that answers at once (a proxy cutting the hold short) must not turn this into a busy loop.
          const early = MIN_POLL_INTERVAL_MS - (Date.now() - asked)
          if (early > 0)
            await new Promise((resolve) => setTimeout(resolve, Math.min(early, Math.max(0, deadline - Date.now()))))
          continue
        }
        return finish(run, result.data)
      }
    } catch (error) {
      if (attempt !== run || run.settled) return
      run.settled = true
      stopTicker()
      setPhase({ type: "failed", url: url(), error: errorText(error) })
    }
  }

  async function submitPaste(value: string) {
    const current = phase()
    const run = attempt
    if (current.type !== "waiting" || !run || run.settled) return
    const parsed = parseAuthorizationInput(value)
    if (!parsed) return setPasteError("Paste the full address from the browser, or the value of its code parameter.")
    if ("error" in parsed) return setPasteError(`The authorization server refused: ${parsed.error}`)
    if (parsed.state && parsed.state !== current.oauthState)
      return setPasteError("That address belongs to a different sign-in attempt. Paste the latest one.")
    setPasteError(undefined)
    setPhase({ ...current, type: "finishing" })
    try {
      const result = await sdk.client.mcp.auth.callback(
        { name: props.name, workspace, code: parsed.code },
        { throwOnError: true, signal: run.abort.signal },
      )
      await finish(run, result.data)
    } catch (error) {
      if (attempt !== run || run.settled) return
      setPhase({ ...current, type: "waiting" })
      setPasteError(errorText(error))
    }
  }

  function copyUrl() {
    const value = url()
    if (!value || !clipboard.write) return
    void clipboard.write(value).then(
      () => toast.show({ variant: "info", message: "Authorization URL copied" }),
      (error) => toast.error(error),
    )
  }

  useBindings(() => ({
    commands: [
      { name: "dialog.mcp.auth.copy", title: "Copy authorization URL", category: "Dialog", run: copyUrl },
      {
        name: "dialog.mcp.auth.retry",
        title: "Retry MCP authentication",
        category: "Dialog",
        run: () => {
          const type = phase().type
          if (type === "failed" || type === "timeout") void start()
        },
      },
    ],
    bindings: tuiConfig.keybinds.gather("dialog.mcp.auth", ["dialog.mcp.auth.copy", "dialog.mcp.auth.retry"]),
  }))

  useBindings(() => ({
    target: textareaTarget,
    enabled: textareaTarget() !== undefined && phase().type === "waiting",
    priority: 1,
    commands: [
      {
        name: "dialog.prompt.submit",
        title: "Submit authorization code",
        category: "Dialog",
        run: () => void submitPaste(textarea?.plainText ?? ""),
      },
    ],
    bindings: tuiConfig.keybinds.gather("dialog.prompt", ["dialog.prompt.submit"]),
  }))

  onMount(() => {
    dialog.setSize("large")
    void start()
  })
  onCleanup(abandon)

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Authenticate {props.name}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc cancel
        </text>
      </box>
      <Switch>
        <Match when={phase().type === "starting"}>
          <Spinner>Starting sign-in…</Spinner>
        </Match>
        <Match when={phase().type === "waiting" || phase().type === "finishing"}>
          <Show when={phase().type === "waiting"} fallback={<Spinner>Finishing sign-in and reconnecting…</Spinner>}>
            <Spinner>Waiting for you to approve in the browser ({formatRemaining(remaining())} left)</Spinner>
          </Show>
          <Show when={browserFailure(phase())}>
            {(reason) => (
              <text fg={theme.warning} wrapMode="word">
                Could not open a browser here ({reason()}). Open the URL below on any machine.
              </text>
            )}
          </Show>
        </Match>
        <Match when={phase().type === "timeout"}>
          <text fg={theme.warning} wrapMode="word">
            Timed out waiting for approval. The attempt was cancelled; stored credentials were not changed.
          </text>
        </Match>
        <Match when={phase().type === "failed"}>
          <text fg={theme.error} wrapMode="word">
            Sign-in failed: {(phase() as { error: string }).error}
          </text>
        </Match>
      </Switch>
      <Show when={url()}>
        {(value) => (
          <box>
            <text fg={theme.textMuted}>Authorization URL</text>
            <text fg={theme.text} wrapMode="char">
              {value()}
            </text>
          </box>
        )}
      </Show>
      <Show when={phase().type === "waiting"}>
        <box gap={1}>
          <text fg={theme.textMuted} wrapMode="word">
            Browser on another machine, or the page shows a connection error after approving? Paste its full address (or
            the code) here.
          </text>
          <textarea
            height={2}
            ref={(value: TextareaRenderable) => {
              textarea = value
              setTextareaTarget(value)
              setTimeout(() => {
                if (!value.isDestroyed) value.focus()
              }, 1)
            }}
            placeholder="http://127.0.0.1:19876/mcp/oauth/callback?code=…&state=…"
            placeholderColor={theme.textMuted}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.text}
            cursorStyle={tuiConfig.cursor}
          />
          <Show when={pasteError()}>
            <text fg={theme.error} wrapMode="word">
              {pasteError()}
            </text>
          </Show>
        </box>
      </Show>
      <box flexDirection="row" gap={2}>
        <Show when={phase().type === "waiting" && submitShortcut()}>
          <text fg={theme.text}>
            {submitShortcut()} <span style={{ fg: theme.textMuted }}>submit pasted code</span>
          </text>
        </Show>
        <Show when={url() && copyShortcut()}>
          <text fg={theme.text} onMouseUp={copyUrl}>
            {copyShortcut()} <span style={{ fg: theme.textMuted }}>copy URL</span>
          </text>
        </Show>
        <Show when={(phase().type === "failed" || phase().type === "timeout") && retryShortcut()}>
          <text fg={theme.text} onMouseUp={() => void start()}>
            {retryShortcut()} <span style={{ fg: theme.textMuted }}>try again</span>
          </text>
        </Show>
      </box>
    </box>
  )
}

function browserFailure(phase: Phase) {
  if (phase.type !== "waiting" && phase.type !== "finishing") return undefined
  return phase.browser.opened ? undefined : phase.browser.reason
}

function formatRemaining(ms: number) {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; error?: unknown; data?: { message?: unknown } }
    for (const candidate of [value.message, value.error, value.data?.message])
      if (typeof candidate === "string" && candidate) return candidate
  }
  return "An unknown error has occurred"
}
