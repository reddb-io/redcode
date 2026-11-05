import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Voice } from "@opencode/schema/voice"
import { Credential } from "@opencode/schema/credential"
import { Button } from "@opencode/ui/button"
import { useLanguage } from "@/runtime/i18n/language"
import type { ServerApi } from "@/runtime/server/api"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import type { SettingsServer } from "./servers/inventory"
import { showToast } from "@/shell/notifications/toast"
import { errorStatus } from "@/shell/errors/description"
import { useSettings } from "@/settings/model"
import { usePlatform } from "@/runtime/platform/platform"
import { VoiceRecorder, voiceAudioBase64 } from "@opencode/util/voice-recorder"
import { VoiceRealtime } from "@opencode/util/voice-realtime"
import { createVoiceInput, type VoiceState } from "@opencode/util/voice-input"

export function SettingsVoice(props: {
  servers: Accessor<SettingsServer[]>
  source: Accessor<ServerConnection.Any | undefined>
}) {
  const language = useLanguage()
  const global = useGlobal()
  const [chosen, setChosen] = createSignal<string>()
  const selected = createMemo(() => {
    const source = props.source()
    const key =
      chosen() ?? (source ? ServerConnection.key(source) : props.servers().length === 1 ? props.servers()[0]?.key : undefined)
    return props.servers().find((server) => server.key === key)
  })

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("voice.settings")}</h2>
            <span class="text-11-regular text-ink-muted">{language.t("voice.description")}</span>
          </div>
        </div>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">
        <Show when={props.servers().length > 1}>
          <label class="flex flex-col gap-1 text-body">
            {language.t("voice.settings.server")}
            <select
              class="h-8 w-full rounded-md border border-stroke-base bg-surface-base px-2 text-body"
              value={selected()?.key ?? ""}
              onChange={(event) => setChosen(event.currentTarget.value || undefined)}
            >
              <option value="">{language.t("voice.settings.chooseServer")}</option>
              <For each={props.servers()}>
                {(server) => <option value={server.key}>{server.name}</option>}
              </For>
            </select>
          </label>
        </Show>
        <Show when={selected()?.connection} keyed fallback={<VoiceSettings />}>
          {(server) => <VoiceSettings api={global.ensureServerCtx(server).sdk.api} />}
        </Show>
      </div>
    </>
  )
}

function VoiceSettings(props: { api?: ServerApi }) {
  const language = useLanguage()
  const api = props.api
  const settings = useSettings()
  const platform = usePlatform()
  const [microphone, setMicrophone] = createStore({
    devices: [] as MediaDeviceInfo[],
    error: "",
    loading: false,
  })
  const refreshMicrophones = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setMicrophone("error", language.t("voice.microphone.unavailable"))
      return
    }
    setMicrophone({ loading: true, error: "" })
    await navigator.mediaDevices.enumerateDevices().then(
      (devices) => setMicrophone({ devices: devices.filter((device) => device.kind === "audioinput"), loading: false }),
      (error: unknown) =>
        setMicrophone({ loading: false, error: error instanceof Error ? error.message : String(error) }),
    )
  }
  const allowMicrophone = async () => {
    setMicrophone({ loading: true, error: "" })
    await (async () => {
      if (platform.requestMicrophone && !(await platform.requestMicrophone()))
        throw new DOMException(language.t("voice.microphone.denied"), "NotAllowedError")
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(language.t("voice.microphone.unavailable"))
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      await refreshMicrophones()
    })().catch((error: unknown) =>
      setMicrophone({
        loading: false,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      }),
    )
  }
  onMount(() => {
    void refreshMicrophones()
    navigator.mediaDevices?.addEventListener("devicechange", refreshMicrophones)
  })
  onCleanup(() => navigator.mediaDevices?.removeEventListener("devicechange", refreshMicrophones))
  const [form, setForm] = createStore({
    provider: "openai" as Voice.Settings["provider"],
    mode: "batch" as NonNullable<Voice.Settings["mode"]>,
    model: "gpt-4o-mini-transcribe",
    connection: "",
    binding: "",
    baseURL: "",
    language: "",
    key: "",
    label: "",
    saving: false,
    failed: "",
    loadError: undefined as "unsupported" | "failed" | undefined,
    loadDetail: "",
  })
  const [saved, setSaved] = createSignal("")
  const [configured, setConfigured] = createSignal(false)
  const fingerprint = () => JSON.stringify([form.provider, form.mode, form.model, form.connection, form.baseURL, form.language, form.key, form.label])
  const [data, { mutate, refetch }] = createResource(async () => {
    if (!api) return
    setForm({ loadError: undefined, loadDetail: "" })
    const loaded = await Promise.all([api.config.get(), api.voice.connections()]).catch((error) => {
      setForm("loadError", errorStatus(error) === 404 ? "unsupported" : "failed")
      setForm("loadDetail", error instanceof Error ? error.message : String(error))
      return undefined
    })
    if (!loaded) return
    const [entries, connections] = loaded
    const voice = entries
      .flatMap((entry) => (entry.type === "document" && entry.info.voice ? [entry.info.voice] : []))
      .at(-1)
    if (voice)
      setForm({
        ...voice,
        mode: voice.mode ?? "batch",
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
    setConfigured(!!voice)
    setSaved(fingerprint())
    return connections
  })
  const save = async () => {
    if (!api) return
    setForm({ saving: true, failed: "" })
    const connection =
      form.connection === "new"
        ? await api.voice.connect({ label: form.label.trim(), key: form.key.trim() }).then(
            (entry) => {
              mutate((entries) => [...(entries ?? []), entry])
              setForm({ connection: entry.id, key: "" })
              return entry.id
            },
            (error: unknown) => {
              setForm("failed", error instanceof Error ? error.message : String(error))
              return undefined
            },
          )
        : form.connection
    if (connection === undefined) {
      setForm("saving", false)
      return
    }
    await api.config
      .update({
        voice: {
          provider: form.provider,
          ...(form.provider === "elevenlabs" && form.mode === "realtime" ? { mode: "realtime" as const } : {}),
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
        () => {
          setForm("saving", false)
          setConfigured(true)
          setSaved(fingerprint())
          showToast({ title: language.t("voice.settings.saved") })
        },
        (error: unknown) => setForm({ saving: false, failed: error instanceof Error ? error.message : String(error) }),
      )
  }
  const field = "voice-field"
  return (
    <div class="voice-settings">
      <section class="voice-card">
        <div class="voice-card-heading"><span class="voice-card-step">01</span><div><h3>{language.t("voice.microphone")}</h3><p>{language.t("voice.test.deviceHint")}</p></div></div>
        <label class="flex flex-col gap-1 text-body">
          {language.t("voice.microphone")}
          <select
            class={field}
            value={settings.voice.device()}
            onChange={(event) => settings.voice.setDevice(event.currentTarget.value)}
          >
            <option value="" selected={!settings.voice.device()}>{language.t("voice.microphone.default")}</option>
            <Show
              when={
                settings.voice.device() &&
                !microphone.devices.some((device) => device.deviceId === settings.voice.device())
              }
            >
              <option value={settings.voice.device()} selected>{language.t("voice.microphone.missing")}</option>
            </Show>
            <For each={microphone.devices.filter((device) => device.deviceId && device.deviceId !== "default")}>
              {(device, index) => (
                <option value={device.deviceId} selected={settings.voice.device() === device.deviceId}>
                  {device.label || language.t("voice.microphone.unknown", { number: index() + 1 })}
                </option>
              )}
            </For>
          </select>
        </label>
        <div class="voice-actions">
          <Button
            type="button"
            size="small"
            variant="outline"
            disabled={microphone.loading}
            onClick={() => void allowMicrophone()}
          >
            {language.t("voice.microphone.permission")}
          </Button>
          <Button
            type="button"
            size="small"
            variant="outline"
            disabled={microphone.loading}
            onClick={() => void refreshMicrophones()}
          >
            {language.t("voice.microphone.refresh")}
          </Button>
        </div>
        <Show when={microphone.error}>
          <p role="alert" class="text-body text-feedback-danger-foreground">
            {language.t("voice.microphone.failed", { detail: microphone.error })}
          </p>
        </Show>
        <Show when={!api}>
          <p role="status" class="text-body text-ink-muted">
            {language.t("voice.settings.serverUnavailable")}
          </p>
        </Show>
        <Show when={!microphone.loading && !microphone.error && !microphone.devices.length}>
          <p class="text-body text-ink-muted">{language.t("voice.microphone.empty")}</p>
        </Show>
      </section>
      <section class="voice-card">
        <div class="voice-card-heading"><span class="voice-card-step">02</span><div><h3>{language.t("voice.test.providerTitle")}</h3><p>{language.t("voice.test.providerHint")}</p></div></div>
        <Show when={data.loading}>
          <p role="status" class="text-body text-ink-muted">
            {language.t("common.loading")}
          </p>
        </Show>
        <Show when={!form.loadError && data.latest}>
          <fieldset disabled={form.saving || data.loading} class="voice-form">
            <div class="voice-grid">
            <label class="flex flex-col gap-1 text-body">
              {language.t("voice.provider")}
              <select
                class={field}
                value={form.provider}
                onChange={(event) => {
                  const provider = event.currentTarget.value as Voice.Settings["provider"]
                  setForm({
                    provider,
                    mode: "batch",
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
            <Show when={form.provider === "elevenlabs"}>
              <label class="flex flex-col gap-1 text-body">
                {language.t("voice.mode")}
                <select class={field} value={form.mode} onChange={(event) => setForm("mode", event.currentTarget.value as "batch" | "realtime")}>
                  <option value="batch">{language.t("voice.mode.batch")}</option>
                  <option value="realtime">{language.t("voice.mode.realtime")}</option>
                </select>
              </label>
            </Show>
            </div>
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
                <For each={data.latest}>
                  {(connection) => <option value={connection.id}>{connection.label}</option>}
                </For>
                <option value="new">{language.t("voice.newConnection")}</option>
                <Show when={form.binding}>
                  <option value={`env:${form.binding}`}>
                    {language.t("voice.environment", { name: form.binding })}
                  </option>
                </Show>
              </select>
            </label>
            <Button type="button" size="small" variant="outline" class="voice-add-key" onClick={() => setForm({ connection: "new", key: "", label: form.provider === "elevenlabs" ? "ElevenLabs" : "Voice" })}>
              {form.provider === "elevenlabs" ? language.t("voice.connection.addElevenLabs") : language.t("voice.newConnection")}
            </Button>
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
            <details class="voice-advanced" open={form.provider === "openai-compatible"}>
              <summary>{language.t("voice.test.advanced")}</summary>
              <div class="voice-advanced-fields">
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
              </div>
            </details>
            <Show when={form.failed}>
              <p role="alert" class="text-body">
                {language.t("common.requestFailed")}
                <span class="block break-words">
                  {language.t("voice.settings.errorDetail", { detail: form.failed })}
                </span>
              </p>
            </Show>
          </fieldset>
        </Show>
        <Show when={form.loadError}>
          {(error) => (
            <div class="flex flex-col items-start gap-3">
              <p role="alert" class="text-body text-feedback-danger-foreground">
                {language.t(error() === "unsupported" ? "voice.settings.unsupported" : "voice.settings.loadFailed")}
                <Show when={form.loadDetail && error() !== "unsupported"}>
                  <span class="block break-words">
                    {language.t("voice.settings.errorDetail", { detail: form.loadDetail })}
                  </span>
                </Show>
              </p>
              <Button type="button" size="small" variant="outline" onClick={() => void refetch()}>
                {language.t("common.retry")}
              </Button>
            </div>
          )}
        </Show>
      <div class="flex justify-end">
        <Button
          type="button"
          disabled={
            !api ||
            data.loading ||
            !!form.loadError ||
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
      </div>
      </section>
      <VoiceSettingsTest api={api} device={settings.voice.device()} enabled={!!api && configured() && !!saved() && saved() === fingerprint() && !form.saving && !form.loadError} />
    </div>
  )
}

function VoiceSettingsTest(props: { api?: ServerApi; device: string; enabled: boolean }) {
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createStore<VoiceState>({ phase: "idle", seconds: 0, level: 0, retry: false })
  const [transcript, setTranscript] = createSignal("")
  const [detail, setDetail] = createSignal("")
  const [monitor, setMonitor] = createStore({ active: false, loading: false, level: 0, error: "" })
  let monitorStream: MediaStream | undefined
  let monitorContext: AudioContext | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let generation = 0
  const stopMonitor = () => {
    generation++
    clearInterval(timer)
    monitorStream?.getTracks().forEach((track) => track.stop())
    monitorStream = undefined
    void monitorContext?.close().catch(() => undefined)
    monitorContext = undefined
    setMonitor({ active: false, loading: false, level: 0 })
  }
  const startMonitor = async () => {
    stopMonitor()
    const current = generation
    setMonitor({ loading: true, error: "" })
    try {
      if (platform.requestMicrophone && !(await platform.requestMicrophone())) throw new Error(language.t("voice.microphone.denied"))
      const stream = await navigator.mediaDevices.getUserMedia({ audio: props.device ? { deviceId: { exact: props.device } } : true })
      if (current !== generation) { stream.getTracks().forEach((track) => track.stop()); return }
      monitorStream = stream
      const context = new AudioContext()
      monitorContext = context
      await context.resume()
      if (current !== generation) return
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples)
        setMonitor("level", Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) * 4))
      }, 100)
      setMonitor({ loading: false, active: true })
    } catch (error) {
      if (current !== generation) return
      stopMonitor()
      setMonitor("error", error instanceof Error ? error.message : String(error))
    }
  }
  const voice = createVoiceInput({
    recorder: () => new VoiceRecorder(),
    realtime: (update) => new VoiceRealtime(update),
    read: () => ({ owner: "settings-test", revision: "" }),
    prepare: async () => {
      if (!props.api) throw new Error("unavailable")
      if (platform.requestMicrophone && !(await platform.requestMicrophone())) throw new DOMException("Microphone permission denied", "NotAllowedError")
      const entries = await props.api.config.get()
      const selected = entries.flatMap((entry) => entry.type === "document" && entry.info.voice ? [entry.info.voice] : []).at(-1)
      if (!selected) throw new Error("unavailable")
      if (selected.provider === "elevenlabs" && selected.mode === "realtime") return props.api.voice.realtime({}).catch((error: unknown) => {
        setDetail(error instanceof Error ? error.message : String(error))
        throw error
      })
    },
    transcribe: async (audio, signal) => {
      if (!props.api) throw new Error("unavailable")
      return await props.api.voice.transcribe({ audio: await voiceAudioBase64(audio) }, { signal }).then(
        (result) => result.text,
        (error: unknown) => { setDetail(error instanceof Error ? error.message : String(error)); throw error },
      )
    },
    insert: setTranscript,
    change: setState,
  })
  createEffect(on(() => props.device, () => { stopMonitor(); voice.cancel() }, { defer: true }))
  const busy = () => ["preparing", "recording", "transcribing"].includes(state.phase)
  onCleanup(() => { stopMonitor(); voice.cancel() })
  return (
    <section class="voice-card voice-test-card" aria-label={language.t("voice.test.title")}>
      <div class="voice-card-heading"><span class="voice-card-step">03</span><div><h3>{language.t("voice.test.title")}</h3><p>{language.t("voice.test.description")}</p></div></div>
      <div class="voice-meter-row">
        <Button type="button" size="small" variant="outline" disabled={monitor.loading || busy()} onClick={() => monitor.active ? stopMonitor() : void startMonitor()}>
          {language.t(monitor.active ? "voice.test.stopMonitor" : "voice.test.monitor")}
        </Button>
        <div class="voice-meter" aria-hidden="true">
          <For each={Array.from({ length: 12 }, (_, index) => index)}>{(index) => (
            <span classList={{ active: (monitor.active ? monitor.level : state.level) * 12 > index }} />
          )}</For>
        </div>
        <meter min="0" max="1" value={monitor.active ? monitor.level : state.level} aria-label={language.t("voice.level")} class="sr-only" />
      </div>
      <Show when={monitor.error}><p role="alert" class="text-body text-feedback-danger-foreground">{monitor.error}</p></Show>
      <p class="text-body text-ink-muted">{language.t(props.enabled ? "voice.test.ready" : "voice.test.saveFirst")}</p>
      <div class="flex flex-wrap gap-2">
        <Button type="button" size="small" variant="outline" disabled={state.phase !== "recording" && (!props.enabled || busy())} onClick={() => {
          if (state.phase === "recording") { void voice.finish(); return }
          stopMonitor(); setTranscript(""); setDetail(""); void voice.start(props.device || undefined)
        }}>
          {language.t(state.phase === "recording" ? "voice.test.stop" : "voice.test.record")}
        </Button>
        <Show when={busy() || state.phase === "error"}>
          <Button type="button" size="small" variant="ghost" onClick={voice.cancel}>{language.t("voice.cancel")}</Button>
        </Show>
        <Show when={state.retry}><Button type="button" size="small" variant="ghost" onClick={() => void voice.retry()}>{language.t("voice.retry")}</Button></Show>
      </div>
      <Show when={busy()}><p role="status" class="text-body text-ink-muted">{state.phase === "recording" ? `${language.t("voice.test.recording")} ${state.seconds}s` : language.t(state.phase === "preparing" ? "voice.preparing" : "voice.transcribing")}</p></Show>
      <Show when={state.live}><p class="text-body text-ink-muted">{state.live}</p></Show>
      <Show when={state.error}><p role="alert" class="text-body text-feedback-danger-foreground">{language.t(`voice.error.${state.error === "capture" && detail() ? "transcription" : state.error}`)}</p></Show>
      <Show when={state.error && detail()}><p class="break-words text-body text-ink-muted">{detail()}</p></Show>
      <Show when={transcript() || state.transcript}><div class="rounded-md border border-stroke-base p-2 text-body"><strong>{language.t("voice.test.result")}</strong><p>{transcript() || state.transcript}</p></div></Show>
    </section>
  )
}
