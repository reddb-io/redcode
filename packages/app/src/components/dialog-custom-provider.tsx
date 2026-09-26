import { Button } from "@reddb-io/redcode-ui/button"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { Dialog } from "@reddb-io/redcode-ui/dialog"
import { IconButton } from "@reddb-io/redcode-ui/icon-button"
import { ProviderIcon } from "@reddb-io/redcode-ui/provider-icon"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@reddb-io/redcode-ui/text-field"
import { showToast } from "@/utils/toast"
import { batch, For } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { ExternalLink } from "@/components/external-link"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { type FormState, headerRow, modelRow, validateCustomProvider } from "./dialog-custom-provider-form"

type Props = {
  onBack: () => void
}

export function DialogCustomProvider(props: Props) {

  return (
    <Dialog
      class="h-full"
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={props.onBack}
          aria-label={"Navigate back"}
        />
      }
      transition
    >
      <CustomProviderForm />
    </Dialog>
  )
}

export function CustomProviderForm(props: { autofocus?: boolean } = {}) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()

  const [form, setForm] = createStore<FormState>({
    providerID: "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: [modelRow()],
    headers: [headerRow()],
    err: {},
  })

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)
    if (key === "apiKey") return
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const validate = () => {
    const output = validateCustomProvider({
      form,
      disabledProviders: serverSync().data.config.disabled_providers ?? [],
      existingProviderIDs: new Set(serverSync().data.provider.all.keys()),
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })
    return output.result
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      if ((await serverSDK().protocol) !== "v1") throw new Error("Custom providers are unavailable on this server")
      const disabledProviders = serverSync().data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== result.providerID)

      if (result.key) {
        await serverSDK().client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      }

      await serverSync().updateConfig({
        provider: { [result.providerID]: result.config },
        disabled_providers: nextDisabled,
      })
      return result
    },
    onSuccess: (result) => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: `${result.name} connected`,
        description: `${result.name} models are now available to use.`,
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Request failed", description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return

    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
  }

  return (
    <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
      <div class="px-2.5 flex gap-4 items-center">
        <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
        <div class="text-16-medium text-text-strong">{"Custom provider"}</div>
      </div>

      <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
        <p class="text-14-regular text-text-base">
          {"Configure an OpenAI-compatible provider. See the "}
          <ExternalLink href="https://github.com/reddb-io/redcode" tabIndex={-1}>
            {"provider config docs"}
          </ExternalLink>
          {"."}
        </p>

        <div class="flex flex-col gap-4">
          <TextField
            autofocus={props.autofocus ?? true}
            label={"Provider ID"}
            placeholder={"myprovider"}
            description={"Lowercase letters, numbers, hyphens, or underscores"}
            value={form.providerID}
            onChange={(v) => setField("providerID", v)}
            validationState={form.err.providerID ? "invalid" : undefined}
            error={form.err.providerID}
          />
          <TextField
            label={"Display name"}
            placeholder={"My AI Provider"}
            value={form.name}
            onChange={(v) => setField("name", v)}
            validationState={form.err.name ? "invalid" : undefined}
            error={form.err.name}
          />
          <TextField
            label={"Base URL"}
            placeholder={"https://api.myprovider.com/v1"}
            value={form.baseURL}
            onChange={(v) => setField("baseURL", v)}
            validationState={form.err.baseURL ? "invalid" : undefined}
            error={form.err.baseURL}
          />
          <TextField
            label={"API key"}
            placeholder={"API key"}
            description={"Optional. Leave empty if you manage auth via headers."}
            value={form.apiKey}
            onChange={(v) => setField("apiKey", v)}
          />
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{"Models"}</label>
          <For each={form.models}>
            {(m, i) => (
              <div class="flex gap-2 items-start" data-row={m.row}>
                <div class="flex-1">
                  <TextField
                    label={"ID"}
                    hideLabel
                    placeholder={"model-id"}
                    value={m.id}
                    onChange={(v) => setModel(i(), "id", v)}
                    validationState={m.err.id ? "invalid" : undefined}
                    error={m.err.id}
                  />
                </div>
                <div class="flex-1">
                  <TextField
                    label={"Name"}
                    hideLabel
                    placeholder={"Display Name"}
                    value={m.name}
                    onChange={(v) => setModel(i(), "name", v)}
                    validationState={m.err.name ? "invalid" : undefined}
                    error={m.err.name}
                  />
                </div>
                <IconButton
                  type="button"
                  icon="trash"
                  variant="ghost"
                  class="mt-1.5"
                  onClick={() => removeModel(i())}
                  disabled={form.models.length <= 1}
                  aria-label={"Remove model"}
                />
              </div>
            )}
          </For>
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
            {"Add model"}
          </Button>
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{"Headers (optional)"}</label>
          <For each={form.headers}>
            {(h, i) => (
              <div class="flex gap-2 items-start" data-row={h.row}>
                <div class="flex-1">
                  <TextField
                    label={"Header"}
                    hideLabel
                    placeholder={"Header-Name"}
                    value={h.key}
                    onChange={(v) => setHeader(i(), "key", v)}
                    validationState={h.err.key ? "invalid" : undefined}
                    error={h.err.key}
                  />
                </div>
                <div class="flex-1">
                  <TextField
                    label={"Value"}
                    hideLabel
                    placeholder={"value"}
                    value={h.value}
                    onChange={(v) => setHeader(i(), "value", v)}
                    validationState={h.err.value ? "invalid" : undefined}
                    error={h.err.value}
                  />
                </div>
                <IconButton
                  type="button"
                  icon="trash"
                  variant="ghost"
                  class="mt-1.5"
                  onClick={() => removeHeader(i())}
                  disabled={form.headers.length <= 1}
                  aria-label={"Remove header"}
                />
              </div>
            )}
          </For>
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
            {"Add header"}
          </Button>
        </div>

        <Button
          class="w-auto self-start"
          type="submit"
          size="large"
          variant="primary"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving..." : "Submit"}
        </Button>
      </form>
    </div>
  )
}
