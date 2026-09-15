import { createSignal, onCleanup, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { DialogPrompt } from "../ui/dialog-prompt"
import { NINE_ROUTER_DEFAULT_URL, normalizeNineRouterURL } from "../util/nine-router"

export function DialogNineRouter(props: {
  baseURL?: string
  onConnected: (baseURL: string, signal: AbortSignal) => Promise<void>
}) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const [step, setStep] = createSignal<"url" | "key">("url")
  const [baseURL, setBaseURL] = createSignal(normalizeNineRouterURL(props.baseURL ?? "") ?? NINE_ROUTER_DEFAULT_URL)
  const [busy, setBusy] = createSignal(false)
  const [status, setStatus] = createSignal("")
  const [error, setError] = createSignal("")
  const abort = new AbortController()
  onCleanup(() => abort.abort())

  function back() {
    if (busy()) return
    setError("")
    setStep("url")
  }

  useBindings(() => ({
    enabled: step() === "key" && !busy(),
    bindings: [{ key: "ctrl+b", desc: "Change API URL", group: "Dialog", cmd: back }],
  }))

  async function connect(value: string) {
    if (busy()) return
    const apiKey = value.trim()
    if (!apiKey) {
      setError("Enter the API key from your 9Router dashboard.")
      return
    }
    setBusy(true)
    setError("")
    setStatus("Checking connection, fetching models and saving...")
    try {
      // One server call discovers the models, saves configuration and then the key, and reloads.
      // Once the server has fetched the models it finishes saving even if this dialog is closed.
      const connected = await sdk.client.provider.nineRouter.connect(
        { baseURL: baseURL(), apiKey },
        { signal: abort.signal },
      )
      if (abort.signal.aborted) return
      if (connected.error) {
        setError(connected.error.message)
        return
      }
      if (!connected.data) throw new Error("The server did not return a model list.")
      setStatus("Checking this project's configuration...")
      await props.onConnected(connected.data.baseURL, abort.signal)
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not connect. Check the Redcode server and retry.")
    } finally {
      if (!abort.signal.aborted) setBusy(false)
    }
  }

  // A stable renderable root keeps OpenTUI from recreating the wizard when Show changes steps.
  return (
    <box>
      <Show
        when={step() === "url"}
        fallback={
          <DialogPrompt
            title="9Router · API key"
            placeholder="Paste your 9Router API key"
            busy={busy()}
            busyText={status()}
            onConfirm={connect}
            description={() => (
              <box gap={1}>
                <text fg={theme.textMuted}>{baseURL()}</text>
                <text fg={theme.textMuted}>
                  Copy a key from the 9Router dashboard. Models will be fetched automatically.
                </text>
                <text fg={theme.textMuted}>
                  Saved globally on the Redcode server. Existing model settings are preserved.
                </text>
                <Show when={error()}>
                  <text fg={theme.error}>{error()}</text>
                </Show>
                <Show when={!busy()}>
                  <text fg={theme.textMuted} onMouseUp={back}>
                    ctrl+b change URL
                  </text>
                </Show>
              </box>
            )}
          />
        }
      >
        <DialogPrompt
          title="9Router · API URL"
          value={baseURL()}
          onConfirm={(value) => {
            const url = normalizeNineRouterURL(value)
            if (!url) {
              setError("Enter an HTTP or HTTPS API URL without credentials, query or fragment.")
              return
            }
            setStep("key")
            setBaseURL(url)
            setError("")
          }}
          description={() => (
            <box gap={1}>
              <text fg={theme.textMuted}>Start 9Router, then confirm its API URL, such as localhost:20128.</text>
              <text fg={theme.textMuted}>For a remote Redcode server, localhost refers to that server.</text>
              <Show when={error()}>
                <text fg={theme.error}>{error()}</text>
              </Show>
            </box>
          )}
        />
      </Show>
    </box>
  )
}
