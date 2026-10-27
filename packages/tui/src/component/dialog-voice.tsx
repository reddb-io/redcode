import type { OpenCodeClient } from "@opencode/client"
import { Voice } from "@opencode/schema/voice"
import { createStore } from "solid-js/store"
import type { DialogContext } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import type { useToast } from "../ui/toast"
import { DialogSecret } from "./dialog-secret"

export async function showVoiceSettings(input: {
  api: OpenCodeClient
  dialog: DialogContext
  toast: ReturnType<typeof useToast>
}) {
  const loaded = await Promise.all([input.api.config.get(), input.api.voice.connections()]).catch(() => undefined)
  if (!loaded) {
    input.toast.show({ variant: "error", message: "Could not load Voice settings" })
    return
  }
  const settings = loaded[0]
    .flatMap((entry) => (entry.type === "document" && entry.info.voice ? [entry.info.voice] : []))
    .at(-1)
  const [form, setForm] = createStore({
    provider: settings?.provider ?? "openai",
    model: settings?.model ?? "gpt-4o-mini-transcribe",
    connection: settings?.connection,
    baseURL: settings?.baseURL ?? "",
    language: settings?.language ?? "",
    connections: loaded[1],
    saving: false,
  })
  const providers = [
    { value: "openai", title: "OpenAI" },
    { value: "elevenlabs", title: "ElevenLabs" },
    { value: "deepgram", title: "Deepgram" },
    { value: "openai-compatible", title: "OpenAI-compatible endpoint" },
  ] satisfies { value: Voice.Settings["provider"]; title: string }[]
  const edit = (field: "model" | "baseURL" | "language", title: string) =>
    input.dialog.replace(() => (
      <DialogPrompt
        title={title}
        value={form[field]}
        onCancel={menu}
        onConfirm={(value) => {
          setForm(field, value.trim())
          menu()
        }}
      />
    ))
  const connections = () =>
    input.dialog.replace(() => (
      <DialogSelect
        title="Voice connection"
        options={[
          ...form.connections.map((entry) => ({
            title: entry.label,
            description: entry.integrationID,
            value: entry.id,
            onSelect: () => {
              setForm("connection", { type: "credential", id: entry.id })
              menu()
            },
          })),
          ...(settings?.connection?.type === "env"
            ? [
                {
                  title: `Configured environment binding: ${settings.connection.name}`,
                  value: "environment",
                  onSelect: () => {
                    setForm("connection", settings.connection)
                    menu()
                  },
                },
              ]
            : []),
          ...(form.provider === "openai-compatible"
            ? [
                {
                  title: "No API key (local endpoint)",
                  value: "none",
                  onSelect: () => {
                    setForm("connection", undefined)
                    menu()
                  },
                },
              ]
            : []),
          { title: "Add a voice API key…", value: "add", onSelect: addConnection },
        ]}
        onCancel={menu}
      />
    ))
  function addConnection() {
    input.dialog.replace(() => (
      <DialogPrompt
        title="Voice connection name"
        onCancel={connections}
        onConfirm={(label) => {
          if (!label.trim()) return
          input.dialog.replace(() => (
            <DialogSecret
              title="Voice API key"
              onCancel={connections}
              onConfirm={(key) => {
                input.dialog.replace(() => <DialogSelect title="Saving voice connection…" locked options={[]} />)
                void input.api.voice.connect({ label: label.trim(), key: key.trim() }).then(
                  (entry) => {
                    setForm("connections", (entries) => [...entries, entry])
                    setForm("connection", { type: "credential", id: entry.id })
                    menu()
                  },
                  () => {
                    input.toast.show({ variant: "error", message: "Could not save the voice API key" })
                    connections()
                  },
                )
              }}
            />
          ))
        }}
      />
    ))
  }
  async function save() {
    if (form.saving) return
    if (
      !form.model ||
      (form.provider !== "openai-compatible" && !form.connection) ||
      (form.provider === "openai-compatible" && !form.baseURL)
    ) {
      input.toast.show({
        variant: "warning",
        message: "Choose a connection and model; compatible providers also require an endpoint",
      })
      return
    }
    setForm("saving", true)
    await input.api.config
      .update({
        voice: {
          provider: form.provider,
          model: form.model,
          ...(form.connection ? { connection: form.connection } : {}),
          ...(form.baseURL ? { baseURL: form.baseURL } : {}),
          ...(form.language ? { language: form.language } : {}),
        },
      })
      .then(
        () => {
          input.dialog.clear()
          input.toast.show({ variant: "success", message: "Voice settings saved. Use /voice to record." })
        },
        () => {
          setForm("saving", false)
          input.toast.show({ variant: "error", message: "Could not save Voice settings" })
        },
      )
  }
  function menu() {
    const connection = form.connection
    input.dialog.replace(() => (
      <DialogSelect
        title="Voice settings"
        locked={form.saving}
        options={[
          {
            title: "Transcription provider",
            value: "provider",
            description: providers.find((entry) => entry.value === form.provider)?.title,
            onSelect: () =>
              input.dialog.replace(() => (
                <DialogSelect
                  title="Transcription provider"
                  options={providers}
                  current={form.provider}
                  onCancel={menu}
                  onSelect={(entry) => {
                    setForm({
                      provider: entry.value,
                      model:
                        entry.value === "elevenlabs"
                          ? "scribe_v2"
                          : entry.value === "deepgram"
                            ? "nova-3"
                            : "gpt-4o-mini-transcribe",
                      connection: undefined,
                      baseURL: "",
                    })
                    menu()
                  }}
                />
              )),
          },
          {
            title: "Saved API key connection",
            value: "connection",
            description:
              connection?.type === "credential"
                ? (form.connections.find((entry) => entry.id === connection.id)?.label ?? "Unavailable connection")
                : connection?.type === "env"
                  ? `Environment: ${connection.name}`
                  : "No connection selected",
            onSelect: connections,
          },
          {
            title: "Transcription model",
            value: "model",
            description: form.model,
            onSelect: () => edit("model", "Transcription model"),
          },
          {
            title: "Endpoint URL",
            value: "endpoint",
            description: form.baseURL || "Provider default",
            onSelect: () => edit("baseURL", "Endpoint URL (empty for provider default)"),
          },
          {
            title: "Language code",
            value: "language",
            description: form.language || "Automatic detection",
            onSelect: () => edit("language", "Language code (empty for automatic detection)"),
          },
          { title: "Save voice settings", value: "save", onSelect: () => void save() },
        ]}
      />
    ))
  }
  menu()
}
