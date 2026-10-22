import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, type Component } from "solid-js"
import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ReactView } from "@/runtime/react/view"
import { UnpaidModelDialog } from "./unpaid.react"
import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { useIntegrations } from "@/providers/catalog/integrations"
import { decode64 } from "@/runtime/persistence/base64"
import { useLanguage } from "@/runtime/i18n/language"

type ModelState = ModelSelection

const featuredProviders = ["opencode-go", "opencode", "openai", "anthropic", "google", "github-copilot"]

const displayModelName = (name: string) => name.replace(/\s+(?:\(free\)|free)$/i, "")

export const DialogSelectModelUnpaid: Component<{ model?: ModelState }> = (props) => {
  const local = useLocal()
  const model = props.model ?? local.model
  const dialog = useDialog()
  const modal = useNativeDialog()
  const directory = () => decode64(local.slug())
  const integrations = useIntegrations(directory)
  const language = useLanguage()

  const currentKey = createMemo(() => {
    const c = model.current()

    return c ? `${c.provider.id}:${c.id}` : undefined
  })

  const isFree = (item: ReturnType<ModelState["list"]>[number]) =>
    item.provider.id === "opencode" && (!item.cost || item.cost.input === 0)

  const providerName = (provider: { id: string; name: string }) =>
    provider.id === "opencode" ? language.t("provider.connect.opencode.name") : provider.name

  const freeModels = createMemo(() => model.list().filter(isFree))

  const openProviders = (provider?: string) => {
    void import("@/providers/connect/dialog").then((x) => {
      const controller = x.useProviderConnectController()
      controller.select(provider)
      void dialog.show(() => <x.DialogConnectProvider controller={controller} directory={directory()} />)
    })
  }

  const selectModel = (item: ReturnType<ModelState["list"]>[number]) => {
    model.set({ modelID: item.id, providerID: item.provider.id }, { recent: true })
    dialog.close()
  }

  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    open: modal.open(),
    current: currentKey(),
    models: freeModels().map((item) => ({
      ...item,
      provider: { ...item.provider },
      limit: { ...item.limit },
      capabilities: { ...item.capabilities, input: { ...item.capabilities.input } },
      name: displayModelName(item.name),
    })),
    providers: integrations
      .list()
      .filter((provider) => featuredProviders.includes(provider.id))
      .toSorted((a, b) => featuredProviders.indexOf(a.id) - featuredProviders.indexOf(b.id))
      .map((provider) => ({ id: provider.id, name: providerName(provider) })),
  }))
  return <ReactView component={UnpaidModelDialog} props={{ source, selectModel, openProviders, close: modal.close }} />
}
