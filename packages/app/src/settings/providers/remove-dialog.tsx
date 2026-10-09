import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { ProviderRemoval } from "@opencode/schema/provider-removal"
import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"

/** Shows what a complete provider removal will delete and runs it once the user confirms. */
export function DialogRemoveProvider(props: {
  name: string
  preview: ProviderRemoval.Result
  /** Resolves whether the provider was removed; failures are reported by the caller. */
  onRemove: () => Promise<boolean>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [state, setState] = createStore({ busy: false })
  const items = () => ProviderRemoval.items(props.preview)
  const line = (item: ProviderRemoval.Item) => {
    if (item.kind === "credentials") return language.plural("settings.providers.remove.item.credentials", item.count)
    if (item.kind === "mcp") return language.t("settings.providers.remove.item.mcp")
    if (item.kind === "config") return language.t("settings.providers.remove.item.config", { path: item.path })
    if (item.kind === "reference") return language.t("settings.providers.remove.item.reference", { name: item.name })
    if (item.kind === "learnedLimits")
      return language.plural("settings.providers.remove.item.learnedLimits", item.count)
    if (item.kind === "hidden")
      return item.variables.length
        ? language.t("settings.providers.remove.item.hidden", { variables: item.variables.join(", ") })
        : language.t("settings.providers.remove.item.hiddenPolicy")
    return language.t("settings.providers.remove.item.kept", { path: item.path })
  }
  const confirm = async () => {
    setState("busy", true)
    // A failed removal keeps the dialog open so the user can retry or cancel.
    const removed = await props.onRemove()
    setState("busy", false)
    if (removed) dialog.close()
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("settings.providers.remove.title", { provider: props.name })}
          description={language.t("settings.providers.remove.description")}
        />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-1 px-4 pb-2">
        <ul class="flex flex-col gap-1 text-12-regular">
          <For each={items().filter((item) => item.kind !== "referencingFile")}>{(item) => <li>{line(item)}</li>}</For>
        </ul>
        <Show when={items().some((item) => item.kind === "referencingFile")}>
          <ul class="flex flex-col gap-1 text-12-regular text-ink-muted">
            <For each={items().filter((item) => item.kind === "referencingFile")}>
              {(item) => <li>{line(item)}</li>}
            </For>
          </ul>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" disabled={state.busy} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="danger" disabled={state.busy} onClick={() => void confirm()}>
          {language.t("settings.providers.remove.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
