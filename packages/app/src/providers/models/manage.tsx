import { useDialog } from "@opencode/ui/context/dialog"
import { useLocal } from "@/providers/models/selection"
import { useLanguage } from "@/runtime/i18n/language"
import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ReactView } from "@/runtime/react/view"
import { DialogConnectProvider } from "@/providers/connect/dialog"
import { decode64 } from "@/runtime/persistence/base64"
import { ManageModelsDialog } from "./manage.react"
import "@/settings/settings.css"

export function createModelVisibilityServices() {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()
  const modal = useNativeDialog()
  return {
    snapshot: sharedSource(() => ({
      language: sharedLanguage(language),
      open: modal.open(),
      models: local.model.list().map((item) => ({
        id: item.id,
        name: item.name,
        provider: { ...item.provider },
        cost: item.cost ? { ...item.cost } : undefined,
        visible: local.model.visible({ modelID: item.id, providerID: item.provider.id }),
      })),
    })),
    visible: (providerID: string, modelID: string, checked: boolean) =>
      local.model.setVisibility({ modelID, providerID }, checked),
    provider: (providerID: string, checked: boolean) =>
      local.model
        .list()
        .filter((item) => item.provider.id === providerID)
        .forEach((item) => local.model.setVisibility({ modelID: item.id, providerID }, checked)),
    connect: () => void dialog.show(() => <DialogConnectProvider directory={decode64(local.slug())} />),
    close: modal.close,
  }
}

export function DialogManageModels() {
  const services = createModelVisibilityServices()
  return <ReactView component={ManageModelsDialog} props={{ services }} />
}
