import { createSignal, onCleanup, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { DialogPrompt } from "../ui/dialog-prompt"

export function DialogNineRouter(props: {
  baseURL?: string
  onConnected: (baseURL: string, signal: AbortSignal) => Promise<void>
}) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const [step, setStep] = createSignal<"url" | "key">("url")
  const [baseURL, setBaseURL] = createSignal(props.baseURL ?? "http://127.0.0.1:20128/v1")
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
    if (!value.trim()) {
      setError("Enter the API key from your 9Router dashboard.")
      return
    }
    setBusy(true)
    setError("")
    setStatus("Checking connection and fetching models...")
    try {
      const discovered = await sdk.client.provider.discover(
        { baseURL: baseURL(), apiKey: value.trim() },
        { signal: abort.signal },
      )
      if (abort.signal.aborted) return
      if (discovered.error) {
        setError(discovered.error.message)
        return
      }
      if (!discovered.data) throw new Error("The server did not return a model list.")
      const existing = await sdk.client.global.config.get({ signal: abort.signal, throwOnError: true })
      if (abort.signal.aborted) return
      setStatus("Saving credential...")
      const auth = await sdk.client.auth.set(
        {
          providerID: "9router",
          auth: { type: "api", key: value.trim() },
        },
        { signal: abort.signal },
      )
      if (abort.signal.aborted) return
      if (auth.error) throw new Error("Could not save the API key. Retry to finish connecting.")

      setStatus("Saving provider configuration...")
      const config = await sdk.client.global.config.update(
        {
          config: {
            provider: {
              "9router": {
                npm: "@ai-sdk/openai-compatible",
                name: "9Router",
                options: { baseURL: discovered.data.baseURL },
                models: Object.fromEntries(
                  discovered.data.models.map((model) => [
                    model.id,
                    existing.data.provider?.["9router"]?.models?.[model.id] ? {} : { name: model.name },
                  ]),
                ),
              },
            },
          },
        },
        { signal: abort.signal },
      )
      if (abort.signal.aborted) return
      if (config.error)
        throw new Error("API key saved, but provider configuration could not be saved. Retry to finish connecting.")
      setStatus("Reloading providers...")
      await props.onConnected(discovered.data.baseURL, abort.signal)
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
            const url = URL.parse(value.trim())
            if (
              !url ||
              !["http:", "https:"].includes(url.protocol) ||
              url.username ||
              url.password ||
              url.search ||
              url.hash
            ) {
              setError("Enter an HTTP or HTTPS API URL without credentials, query or fragment.")
              return
            }
            if (url.pathname === "/") url.pathname = "/v1"
            setStep("key")
            setBaseURL(url.toString().replace(/\/+$/, ""))
            setError("")
          }}
          description={() => (
            <box gap={1}>
              <text fg={theme.textMuted}>Start 9Router, then confirm its API URL (including /v1).</text>
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
