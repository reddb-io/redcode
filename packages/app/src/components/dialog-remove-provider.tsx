import { Button } from "@reddb-io/redcode-ui/button"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { Dialog } from "@reddb-io/redcode-ui/dialog"
import { ButtonV2 } from "@reddb-io/redcode-ui/v2/button-v2"
import { DialogBody, DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@reddb-io/redcode-ui/v2/dialog-v2"
import { type Accessor, createMemo, createSignal, For } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { providerRemoveSummary, type ProviderRemoval } from "./provider-remove"

// Call from inside the settings server scope: the confirm dialog is pushed above settings and
// does not see that scope, so the server calls are bound here and handed to the dialog.
export function useProviderRemove(options: { v2?: boolean; directory?: Accessor<string | undefined> } = {}) {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()

  const request = (providerID: string, dryRun: "true" | "false") =>
    serverSDK().client.provider.remove({ providerID, directory: options.directory?.(), dryRun }, { throwOnError: true })

  const failed = (err: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })

  const remove = (providerID: string, name: string) =>
    request(providerID, "false")
      .then(async () => {
        await serverSync()
          .refreshProviders()
          .catch(() => undefined)
        dialog.close()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.remove.toast.title", { provider: name }),
          description: language.t("provider.remove.toast.description", { provider: name }),
        })
      })
      .catch(failed)

  return (providerID: string, name: string) =>
    request(providerID, "true")
      .then((result) =>
        dialog.push(() => (
          <DialogRemoveProvider
            name={name}
            result={result.data}
            v2={options.v2}
            onConfirm={() => remove(providerID, name)}
          />
        )),
      )
      .catch(failed)
}

function DialogRemoveProvider(props: {
  name: string
  result: ProviderRemoval
  v2?: boolean
  onConfirm: () => Promise<unknown>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [pending, setPending] = createSignal(false)
  const summary = createMemo(() => providerRemoveSummary(props.result, props.name, language.t))

  const confirm = () => {
    setPending(true)
    void props.onConfirm().finally(() => setPending(false))
  }

  const details = () => (
    <div class="flex flex-col gap-2">
      <ul class="flex flex-col gap-1 list-disc pl-5 text-14-regular text-text-strong">
        <For each={summary().removed}>{(line) => <li>{line}</li>}</For>
      </ul>
      <For each={summary().notes}>{(line) => <p class="text-12-regular text-text-weak">{line}</p>}</For>
    </div>
  )

  if (props.v2)
    return (
      <DialogV2 fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("provider.remove.title", { provider: props.name })}
            description={language.t("provider.remove.description")}
          />
        </DialogHeader>
        <DialogBody class="px-4">{details()}</DialogBody>
        <DialogFooter>
          <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 variant="danger" disabled={pending()} onClick={confirm}>
            {language.t("provider.remove.button")}
          </ButtonV2>
        </DialogFooter>
      </DialogV2>
    )

  return (
    <Dialog title={language.t("provider.remove.title", { provider: props.name })} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <span class="text-14-regular text-text-strong">{language.t("provider.remove.description")}</span>
        {details()}
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={pending()} onClick={confirm}>
            {language.t("provider.remove.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
