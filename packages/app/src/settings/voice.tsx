import { createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Voice } from "@opencode/schema/voice"
import { Credential } from "@opencode/schema/credential"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import type { ServerApi } from "@/runtime/server/api"
import { errorStatus } from "@/shell/errors/description"

export function VoiceSettings(props: { api: ServerApi }) {
  const language = useLanguage()
  const api = props.api
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
    loadError: undefined as "unsupported" | "failed" | undefined,
  })
  const [data, { mutate, refetch }] = createResource(async () => {
    setForm("loadError", undefined)
    const loaded = await Promise.all([api.config.get(), api.voice.connections()]).catch((error) => {
      setForm("loadError", errorStatus(error) === 404 ? "unsupported" : "failed")
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
        <Show when={data.loading}>
          <p role="status" class="text-body text-ink-muted">
            {language.t("common.loading")}
          </p>
        </Show>
        <Show when={!form.loadError && data.latest}>
          <fieldset disabled={form.saving || data.loading} class="flex min-w-0 flex-col gap-3">
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
            <Show when={form.failed}>
              <p role="alert" class="text-body">
                {language.t("common.requestFailed")}
              </p>
            </Show>
          </fieldset>
        </Show>
        <Show when={form.loadError}>
          {(error) => (
            <div class="flex flex-col items-start gap-3">
              <p role="alert" class="text-body text-feedback-danger-foreground">
                {language.t(error() === "unsupported" ? "voice.settings.unsupported" : "voice.settings.loadFailed")}
              </p>
              <Button type="button" size="small" variant="outline" onClick={() => void refetch()}>
                {language.t("common.retry")}
              </Button>
            </div>
          )}
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          disabled={
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
      </DialogFooter>
    </Dialog>
  )
}
