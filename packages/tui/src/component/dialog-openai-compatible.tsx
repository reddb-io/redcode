import { createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import type { ProviderOpenaiCompatibleConnectResponses } from "@reddb-io/redcode-sdk/v2"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import {
  type CompatibleNpm,
  COMPATIBLE_NPM,
  isEnvReference,
  keyProblem,
  normalizeBaseURL,
  normalizeProviderID,
  parseManualModels,
  suggestName,
  suggestProviderID,
  type ManualModel,
} from "../util/openai-compatible"

export type ConnectedProvider = ProviderOpenaiCompatibleConnectResponses[200]

/** What the wizard knows about an id before connecting, from the TUI's synced configuration. */
export type ProviderLookup = {
  /** A configured OpenAI-compatible provider with this id: its settings prefill the wizard. */
  existing?: { name?: string; baseURL?: string; npm?: string; hasKey: boolean; hasModels: boolean }
  /** Another provider (built-in or configured differently) already uses this id. */
  taken: boolean
}

/** A fixed provider the wizard connects with a known id and name, such as 9Router. */
export type ProviderPreset = {
  providerID: string
  name: string
  defaultURL: string
  urlHint: string
  keyHint: string
}

type Step = "move" | "url" | "id" | "override" | "replace" | "name" | "api" | "key" | "models"

export function DialogOpenAICompatible(props: {
  /** Connect this preset instead of asking for an id, name and API type. */
  preset?: ProviderPreset
  /** Open for a provider that is already configured, to update it. */
  providerID?: string
  /** Offer to move a preset provider that points elsewhere to its own id first. */
  offerMove?: boolean
  lookup: (providerID: string) => ProviderLookup
  onConnected: (result: ConnectedProvider, signal: AbortSignal) => Promise<void>
}) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const initialID = props.preset?.providerID ?? props.providerID
  const initial = initialID ? props.lookup(initialID) : undefined

  const [step, setStep] = createSignal<Step>(props.offerMove ? "move" : "url")
  const [history, setHistory] = createSignal<Step[]>([])
  const [fixedID, setFixedID] = createSignal(!!initialID)
  const [moveFrom, setMoveFrom] = createSignal<string>()
  const [providerID, setProviderID] = createSignal(initialID ?? "")
  const [override, setOverride] = createSignal(false)
  const [replaceCredential, setReplaceCredential] = createSignal(false)
  const [name, setName] = createSignal(props.preset?.name ?? initial?.existing?.name ?? "")
  const [baseURL, setBaseURL] = createSignal(
    normalizeBaseURL(initial?.existing?.baseURL ?? "") ?? props.preset?.defaultURL ?? "",
  )
  const [npm, setNpm] = createSignal<CompatibleNpm>(
    COMPATIBLE_NPM.find((item) => item === initial?.existing?.npm) ?? COMPATIBLE_NPM[0],
  )
  const [apiKey, setApiKey] = createSignal<string>()
  const [existing, setExisting] = createSignal(initial?.existing)
  const [busy, setBusy] = createSignal(false)
  const [status, setStatus] = createSignal("")
  const [error, setError] = createSignal("")
  const [resume, setResume] = createSignal(false)
  const abort = new AbortController()
  onCleanup(() => abort.abort())

  const preset = () => (moveFrom() ? undefined : props.preset)
  const title = (text: string) => `${preset()?.name ?? "OpenAI-compatible"} · ${text}`

  function go(next: Step) {
    setHistory((items) => [...items, step()])
    setError("")
    setStep(next)
  }

  function back() {
    if (busy()) return
    const items = history()
    if (!items.length) return
    setHistory(items.slice(0, -1))
    setError("")
    setStep(items[items.length - 1])
  }

  // Wizard-scoped and above the prompt's own layer, so ctrl+b goes back a step here instead of moving
  // the cursor or backgrounding subagents in the session underneath.
  useBindings(() => ({
    enabled: history().length > 0 && !busy(),
    priority: 2,
    bindings: [{ key: "ctrl+b", desc: "Previous step", group: "Dialog", cmd: back }],
  }))

  function afterURL() {
    if (preset()) return go("key")
    if (!fixedID()) {
      if (!providerID()) setProviderID(suggestProviderID(baseURL(), (id) => props.lookup(id).taken))
      return go("id")
    }
    go("name")
  }

  function chooseID(value: string) {
    const id = normalizeProviderID(value)
    if (!id) {
      setError("Use lowercase letters, numbers, hyphens and underscores, starting with a letter or number.")
      return
    }
    const found = props.lookup(id)
    setProviderID(id)
    setOverride(false)
    setReplaceCredential(false)
    setExisting(found.existing)
    if (found.existing) {
      if (!name()) setName(found.existing.name ?? "")
      setNpm(COMPATIBLE_NPM.find((item) => item === found.existing?.npm) ?? npm())
    }
    if (moveFrom() && (found.existing || found.taken)) {
      setError(`"${id}" already exists. Choose a new id to move the connection to.`)
      return
    }
    if (found.taken && !found.existing) return go("override")
    go("name")
  }

  function fail(reason: string | undefined, message: string) {
    setError(message)
    const target: Step | undefined = {
      invalid_provider_id: "id" as const,
      invalid_move: "id" as const,
      invalid_url: "url" as const,
      invalid_key: "key" as const,
      invalid_headers: "key" as const,
      invalid_models: "models" as const,
      discovery: "models" as const,
      builtin_provider: "override" as const,
      credential_in_use: "replace" as const,
    }[reason ?? ""]
    if (!target || target === step()) return
    if (target === "override" || target === "replace") setResume(true)
    setHistory((items) => [...items, step()])
    setStep(target)
  }

  async function connect(models?: ManualModel[]) {
    if (busy()) return
    setBusy(true)
    setError("")
    setStatus(models ? "Saving models..." : "Checking connection, fetching models and saving...")
    try {
      // One server call validates, discovers the models, saves configuration and then the key, and
      // reloads. Once the server has fetched the models it finishes saving even if this dialog closes.
      const connected = await sdk.client.provider.openaiCompatible.connect(
        {
          providerID: providerID(),
          name: name() || undefined,
          baseURL: baseURL(),
          apiKey: apiKey(),
          npm: npm(),
          ...(override() ? { override: true } : {}),
          ...(replaceCredential() ? { replaceCredential: true } : {}),
          ...(models ? { models } : {}),
          ...(moveFrom() ? { moveFrom: moveFrom() } : {}),
        },
        { signal: abort.signal },
      )
      if (abort.signal.aborted) return
      if (connected.error) {
        const reason = "reason" in connected.error ? connected.error.reason : undefined
        fail(reason, connected.error.message)
        return
      }
      if (!connected.data) throw new Error("The server did not return the connection.")
      setStatus("Checking this project's configuration...")
      await props.onConnected(connected.data, abort.signal)
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not connect. Check the Redcode server and retry.")
    } finally {
      if (!abort.signal.aborted) setBusy(false)
    }
  }

  const errorView = () => (
    <Show when={error()}>
      <text fg={theme.error}>{error()}</text>
    </Show>
  )
  const backView = () => (
    <Show when={history().length > 0 && !busy()}>
      <text fg={theme.textMuted} onMouseUp={back}>
        ctrl+b previous step
      </text>
    </Show>
  )

  // A stable renderable root keeps OpenTUI from recreating the wizard when steps change.
  return (
    <box>
      <Switch>
        <Match when={step() === "move"}>
          <DialogSelect
            title={`${props.preset?.name ?? providerID()} points to another address`}
            options={[
              {
                title: `Keep it as ${props.preset?.name ?? providerID()}`,
                value: "keep",
                description: baseURL(),
              },
              {
                title: "Move this connection to a new provider id",
                value: "move",
                description: "Its models and saved key move too",
              },
            ]}
            onSelect={(option) => {
              if (option.value === "move") {
                setMoveFrom(providerID())
                setFixedID(false)
                setProviderID("")
                setName("")
                setExisting(undefined)
              }
              go("url")
            }}
          />
        </Match>
        <Match when={step() === "url"}>
          <DialogPrompt
            title={title("API URL")}
            value={baseURL()}
            placeholder="https://api.example.com/v1"
            onConfirm={(value) => {
              const url = normalizeBaseURL(value)
              if (!url) {
                setError("Enter an HTTP or HTTPS API URL without credentials, query or fragment.")
                return
              }
              setBaseURL(url)
              afterURL()
            }}
            description={() => (
              <box gap={1}>
                <text fg={theme.textMuted}>
                  {preset()?.urlHint ??
                    "The base URL of an endpoint that speaks the OpenAI API, usually ending in /v1."}
                </text>
                <text fg={theme.textMuted}>For a remote Redcode server, localhost refers to that server.</text>
                {errorView()}
                {backView()}
              </box>
            )}
          />
        </Match>
        <Match when={step() === "id"}>
          <DialogPrompt
            title={title("Provider id")}
            value={providerID()}
            placeholder="my-provider"
            onConfirm={chooseID}
            description={() => (
              <box gap={1}>
                <text fg={theme.textMuted}>
                  {moveFrom()
                    ? `The new id for the connection now saved as ${moveFrom()}.`
                    : "The id used in configuration and model names (id/model). Each id is a separate provider; an existing one is updated."}
                </text>
                {errorView()}
                {backView()}
              </box>
            )}
          />
        </Match>
        <Match when={step() === "override"}>
          <DialogSelect
            title={`"${providerID()}" is already a provider`}
            options={[
              { title: "Choose a different id", value: "rename" },
              { title: `Override ${providerID()} with this endpoint`, value: "override" },
            ]}
            footer={
              <text fg={theme.warning}>
                Overriding replaces the saved login or key for {providerID()}, and all {providerID()} models will be
                sent to this URL.
              </text>
            }
            onSelect={(option) => {
              if (option.value === "rename") {
                setResume(false)
                setStep("id")
                setError("")
                return
              }
              setOverride(true)
              if (resume()) {
                setResume(false)
                back()
                void connect()
                return
              }
              go("name")
            }}
          />
        </Match>
        <Match when={step() === "replace"}>
          <DialogSelect
            title={`Replace the saved login for ${providerID()}?`}
            options={[
              { title: "Keep it and choose a different id", value: "keep" },
              { title: "Replace it", value: "replace" },
            ]}
            footer={
              <text fg={theme.warning}>
                Your saved login or key for {providerID()} will be replaced, and all {providerID()} models will be sent
                to this URL.
              </text>
            }
            onSelect={(option) => {
              setResume(false)
              if (option.value === "keep") {
                setOverride(false)
                setStep("id")
                setError("")
                return
              }
              setReplaceCredential(true)
              back()
              void connect()
            }}
          />
        </Match>
        <Match when={step() === "name"}>
          <DialogPrompt
            title={title("Display name")}
            value={name() || suggestName(providerID())}
            onConfirm={(value) => {
              setName(value.trim() || suggestName(providerID()))
              go("api")
            }}
            description={() => (
              <box gap={1}>
                <text fg={theme.textMuted}>Shown in the model picker for {providerID()}.</text>
                {errorView()}
                {backView()}
              </box>
            )}
          />
        </Match>
        <Match when={step() === "api"}>
          <DialogSelect
            title={title("API type")}
            current={npm()}
            options={[
              {
                title: "Chat Completions",
                value: "@ai-sdk/openai-compatible" as const,
                description: "/chat/completions · most compatible servers",
              },
              {
                title: "Responses",
                value: "@ai-sdk/openai" as const,
                description: "/responses · OpenAI and servers that implement it",
              },
            ]}
            onSelect={(option) => {
              setNpm(option.value)
              go("key")
            }}
          />
        </Match>
        <Match when={step() === "key"}>
          <DialogPrompt
            title={title("API key")}
            placeholder={preset() ? "Paste your API key" : "API key, {env:VARIABLE}, or empty"}
            busy={busy()}
            busyText={status()}
            onConfirm={(value) => {
              const key = value.trim()
              const problem = keyProblem(key)
              if (problem) return setError(problem)
              if (preset() && !key && !existing()?.hasKey)
                return setError(`Enter the API key from your ${preset()!.name} dashboard.`)
              setApiKey(key || undefined)
              void connect()
            }}
            description={() => (
              <box gap={1}>
                <text fg={theme.textMuted}>{baseURL()}</text>
                <text fg={theme.textMuted}>
                  {preset()?.keyHint ??
                    "Paste a key, or type {env:VARIABLE} to read it from the Redcode server's environment. Leave it empty for endpoints without a key."}
                </text>
                <Show when={existing() || moveFrom()}>
                  <text fg={theme.textMuted}>
                    Leave it empty to keep a key saved for this URL in the global configuration or credential store.
                  </text>
                </Show>
                <text fg={theme.textMuted}>
                  Models are fetched automatically. Settings go to the global config; a pasted key goes to the
                  credential store.
                </text>
                {errorView()}
                {backView()}
              </box>
            )}
          />
        </Match>
        <Match when={step() === "models"}>
          <DialogPrompt
            title={title("Models")}
            placeholder="model-a 128k, model-b"
            busy={busy()}
            busyText={status()}
            onConfirm={(value) => {
              const parsed = parseManualModels(value)
              if ("error" in parsed) return setError(parsed.error)
              void connect(parsed.models)
            }}
            description={() => (
              <box gap={1}>
                {errorView()}
                <text fg={theme.textMuted}>
                  Enter the model ids to use, separated by commas. Add a context size after an id when you know it
                  (128000 or 128k); otherwise a conservative limit is used.
                </text>
                <Show when={isEnvReference(apiKey() ?? "")}>
                  <text fg={theme.textMuted}>The key stays an environment reference.</text>
                </Show>
                {backView()}
              </box>
            )}
          />
        </Match>
      </Switch>
    </box>
  )
}
