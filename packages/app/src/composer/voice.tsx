import { createEffect, createMemo, createResource, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation } from "@solidjs/router"
import { Voice } from "@opencode/schema/voice"
import { Credential } from "@opencode/schema/credential"
import { createVoiceInput, type VoiceState } from "@opencode/util/voice-input"
import { VoiceRecorder, voiceAudioBase64 } from "@opencode/util/voice-recorder"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import type { ServerApi } from "@/runtime/server/api"
import { usePlatform } from "@/runtime/platform/platform"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { ComposerAdapter } from "./adapter"
import { createComposerEditorActions } from "./editor/actions"

export function createComposerVoice(adapter: ComposerAdapter) {
  const server = useServer()
  const route = useLocation()
  const sdk = useWorkspaceLocation()
  const platform = usePlatform()
  const dialog = useDialog()
  const [state, setState] = createStore<VoiceState>({ phase: "idle", seconds: 0, level: 0, retry: false })
  const draft = createComposerEditorActions(adapter.state.store)
  const cursor = { value: 0 }
  const voice = createVoiceInput({
    recorder: () => new VoiceRecorder(),
    read: () => ({
      owner: `${server.key}:${sdk().directory}:${adapter.kind === "active-session" ? adapter.session().id : "new"}`,
      revision: JSON.stringify([adapter.state.current(), adapter.state.mode.current(), adapter.state.context.items()]),
    }),
    prepare: async () => {
      const entries = await server.ctx.sdk.api.config.get({ location: { directory: sdk().directory } })
      if (!entries.some((entry) => entry.type === "document" && entry.info.voice)) {
        dialog.show(() => <VoiceSettings />)
        throw new Error("unavailable")
      }
      cursor.value =
        adapter.state.cursor() ??
        draft.state.prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
      if (platform.requestMicrophone && !(await platform.requestMicrophone()))
        throw new DOMException("Microphone permission denied", "NotAllowedError")
    },
    transcribe: async (audio, signal) =>
      (
        await server.ctx.sdk.api.voice.transcribe(
          { audio: await voiceAudioBase64(audio), location: { directory: sdk().directory } },
          { signal },
        )
      ).text,
    insert: (text) => {
      const before = draft.state.prompt
        .map((part) => ("content" in part ? part.content : ""))
        .join("")
        .slice(0, cursor.value)
      draft.setCursor(cursor.value)
      draft.addText(`${before && !/\s$/.test(before) ? " " : ""}${text} `)
    },
    change: setState,
  })
  onCleanup(voice.cancel)
  // A composer can survive navigation; its own identity still ends the recording.
  const owner = createMemo(
    () =>
      `${route.pathname}${route.search}:${sdk().directory}:${adapter.kind === "active-session" ? adapter.session().id : "new"}`,
  )
  const capturedOwner = { value: owner() }
  createEffect(() => {
    if (owner() !== capturedOwner.value) {
      voice.cancel()
      capturedOwner.value = owner()
    }
  })
  return {
    state,
    busy: () => ["preparing", "recording", "transcribing"].includes(state.phase),
    start: () => voice.start(),
    finish: voice.finish,
    cancel: voice.cancel,
    retry: voice.retry,
    settings: () => dialog.show(() => <VoiceSettings />),
    copy: () =>
      state.transcript &&
      (platform.writeClipboardText?.(state.transcript) ?? navigator.clipboard.writeText(state.transcript)),
  }
}

export function ComposerVoiceControl(props: { voice: ReturnType<typeof createComposerVoice>; disabled?: boolean }) {
  const language = useLanguage()
  const state = props.voice.state
  const label = () => language.t(state.phase === "recording" ? "voice.stop" : "voice.start")
  return (
    <div class="flex items-center gap-1" aria-busy={props.voice.busy()}>
      <Show when={props.voice.busy() || state.phase === "error"}>
        <span class="max-w-24 truncate text-caption text-ink-muted sm:max-w-56" role="status">
          {state.phase === "recording"
            ? `${Math.floor(state.seconds / 60)}:${String(state.seconds % 60).padStart(2, "0")}`
            : state.error
              ? language.t(`voice.error.${state.error}`)
              : language.t(`voice.${state.phase === "preparing" ? "preparing" : "transcribing"}`)}
        </span>
        <Show when={state.phase === "recording"}>
          <meter min="0" max="1" value={state.level} aria-label={language.t("voice.level")} class="h-1 w-10" />
        </Show>
        <Show when={state.retry && state.error !== "changed"}>
          <Button type="button" size="small" variant="ghost" onClick={() => void props.voice.retry()}>
            {language.t("voice.retry")}
          </Button>
        </Show>
        <Show when={state.transcript}>
          <Button type="button" size="small" variant="ghost" onClick={() => void props.voice.copy()}>
            {language.t("voice.copy")}
          </Button>
        </Show>
        <IconButton
          type="button"
          icon={<Icon name="close" size="small" />}
          size="small"
          aria-label={language.t("voice.cancel")}
          onClick={props.voice.cancel}
        />
      </Show>
      <IconButton
        type="button"
        size="small"
        icon={<Icon name={state.phase === "recording" ? "stop" : "microphone"} size="small" />}
        aria-label={label()}
        title={label()}
        aria-pressed={state.phase === "recording"}
        disabled={props.disabled || state.phase === "preparing" || state.phase === "transcribing"}
        onClick={() => void (state.phase === "recording" ? props.voice.finish() : props.voice.start())}
      />
      <IconButton
        type="button"
        size="small"
        icon={<Icon name="settings-gear" size="small" />}
        aria-label={language.t("voice.settings")}
        title={language.t("voice.settings")}
        disabled={props.voice.busy()}
        onClick={props.voice.settings}
      />
    </div>
  )
}

export function VoiceSettings(props: { api?: ServerApi } = {}) {
  const language = useLanguage()
  const api = props.api ?? useServer().ctx.sdk.api
  const dialog = useDialog()
  const [form, setForm] = createStore({
    provider: "openai" as Voice.Settings["provider"],
    model: "gpt-4o-mini-transcribe",
    connection: "",
    binding: "",
    baseURL: "",
    language: "",
    key: "",
    label: "",
    saving: false,
    failed: false,
  })
  const [data, { mutate }] = createResource(async () => {
    const [entries, connections] = await Promise.all([api.config.get(), api.voice.connections()])
    const voice = entries
      .flatMap((entry) => (entry.type === "document" && entry.info.voice ? [entry.info.voice] : []))
      .at(-1)
    if (voice)
      setForm({
        ...voice,
        connection:
          voice.connection?.type === "credential"
            ? voice.connection.id
            : voice.connection?.type === "env"
              ? `env:${voice.connection.name}`
              : "",
        binding: voice.connection?.type === "env" ? voice.connection.name : "",
        baseURL: voice.baseURL ?? "",
        language: voice.language ?? "",
      })
    return connections
  })
  const save = async () => {
    setForm({ saving: true, failed: false })
    const connection =
      form.connection === "new"
        ? await api.voice.connect({ label: form.label.trim(), key: form.key.trim() }).then(
            (entry) => {
              mutate((entries) => [...(entries ?? []), entry])
              setForm({ connection: entry.id, key: "" })
              return entry.id
            },
            () => undefined,
          )
        : form.connection
    if (connection === undefined) {
      setForm({ saving: false, failed: true })
      return
    }
    await api.config
      .update({
        voice: {
          provider: form.provider,
          model: form.model.trim(),
          ...(connection
            ? {
                connection: connection.startsWith("env:")
                  ? { type: "env", name: connection.slice(4) }
                  : { type: "credential", id: Credential.ID.make(connection) },
              }
            : {}),
          ...(form.baseURL.trim() ? { baseURL: form.baseURL.trim() } : {}),
          ...(form.language.trim() ? { language: form.language.trim() } : {}),
        },
      })
      .then(
        () => dialog.close(),
        () => setForm({ saving: false, failed: true }),
      )
  }
  const field = "h-8 w-full rounded-md border border-stroke-base bg-surface-base px-2 text-body"
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("voice.settings")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex flex-col gap-3 px-4 pb-4 !overflow-y-auto">
        <Show when={data()}>
          <fieldset disabled={form.saving} class="flex min-w-0 flex-col gap-3">
            <p class="text-body text-ink-muted">{language.t("voice.description")}</p>
            <label class="flex flex-col gap-1 text-body">
              {language.t("voice.provider")}
              <select
                class={field}
                value={form.provider}
                onChange={(event) => {
                  const provider = event.currentTarget.value as Voice.Settings["provider"]
                  setForm({
                    provider,
                    model:
                      provider === "elevenlabs"
                        ? "scribe_v2"
                        : provider === "deepgram"
                          ? "nova-3"
                          : "gpt-4o-mini-transcribe",
                    connection: "",
                    baseURL: "",
                    key: "",
                  })
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="elevenlabs">ElevenLabs</option>
                <option value="deepgram">Deepgram</option>
                <option value="openai-compatible">{language.t("voice.compatible")}</option>
              </select>
            </label>
            <label class="flex flex-col gap-1 text-body">
              {language.t("voice.connection")}
              <select
                class={field}
                value={form.connection}
                onChange={(event) => setForm({ connection: event.currentTarget.value, key: "" })}
                disabled={form.saving}
              >
                <option value="">
                  {language.t(form.provider === "openai-compatible" ? "voice.noKey" : "voice.chooseConnection")}
                </option>
                <For each={data()}>{(connection) => <option value={connection.id}>{connection.label}</option>}</For>
                <option value="new">{language.t("voice.newConnection")}</option>
                <Show when={form.binding}>
                  <option value={`env:${form.binding}`}>
                    {language.t("voice.environment", { name: form.binding })}
                  </option>
                </Show>
              </select>
            </label>
            <Show when={form.connection === "new"}>
              <label class="flex flex-col gap-1 text-body">
                {language.t("voice.connectionLabel")}
                <input
                  class={field}
                  value={form.label}
                  disabled={form.saving}
                  onInput={(event) => setForm("label", event.currentTarget.value)}
                />
              </label>
              <label class="flex flex-col gap-1 text-body">
                {language.t("voice.apiKey")}
                <input
                  class={field}
                  type="password"
                  autocomplete="new-password"
                  value={form.key}
                  disabled={form.saving}
                  onInput={(event) => setForm("key", event.currentTarget.value)}
                />
              </label>
            </Show>
            <label class="flex flex-col gap-1 text-body">
              {language.t("voice.model")}
              <input
                class={field}
                value={form.model}
                onInput={(event) => setForm("model", event.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-1 text-body">
              {language.t("voice.endpoint")}
              <input
                class={field}
                type="url"
                value={form.baseURL}
                onInput={(event) => setForm("baseURL", event.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-1 text-body">
              {language.t("voice.language")}
              <input
                class={field}
                value={form.language}
                onInput={(event) => setForm("language", event.currentTarget.value)}
              />
            </label>
            <Show when={data.error || form.failed}>
              <p role="alert" class="text-body">
                {language.t("common.requestFailed")}
              </p>
            </Show>
          </fieldset>
        </Show>
        <Show when={data.error}>
          <p role="alert" class="text-body">
            {language.t("common.requestFailed")}
          </p>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          disabled={
            data.loading ||
            !!data.error ||
            form.saving ||
            !form.model.trim() ||
            (form.connection === "new" && (!form.key.trim() || !form.label.trim())) ||
            (form.provider !== "openai-compatible" && !form.connection) ||
            (form.provider === "openai-compatible" && !form.baseURL.trim())
          }
          onClick={() => void save()}
        >
          {language.t("voice.save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
