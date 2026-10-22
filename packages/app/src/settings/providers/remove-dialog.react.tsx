/** @jsxImportSource react */
import { useState } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { ProviderRemoval } from "@opencode/schema/provider-removal"
import type { SettingsLanguage } from "../shared.react"

export function RemoveProviderDialog(props: {
  name: string
  preview: ProviderRemoval.Result
  language: SettingsLanguage
  onRemove: () => Promise<boolean>
  onClose: () => void
}) {
  const language = props.language
  const [busy, setBusy] = useState(false)
  const items = ProviderRemoval.items(props.preview)
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
  return (
    <Dialog
      open
      title={language.t("settings.providers.remove.title", { provider: props.name })}
      description={language.t("settings.providers.remove.description")}
      showClose={false}
      dismissible={!busy}
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose()
      }}
      actions={() => (
        <>
          <Button variant="ghost" disabled={busy} onClick={props.onClose}>
            {language.t("common.cancel")}
          </Button>
          <Button
            tone="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void props.onRemove().then((removed) => {
                setBusy(false)
                if (removed) props.onClose()
              })
            }}
          >
            {language.t("settings.providers.remove.button")}
          </Button>
        </>
      )}
    >
      <ul className="flex flex-col gap-1 text-12-regular">
        {items
          .filter((item) => item.kind !== "referencingFile")
          .map((item, index) => (
            <li key={index}>{line(item)}</li>
          ))}
      </ul>
      {items.some((item) => item.kind === "referencingFile") && (
        <ul className="flex flex-col gap-1 text-12-regular text-ink-muted">
          {items
            .filter((item) => item.kind === "referencingFile")
            .map((item, index) => (
              <li key={index}>{line(item)}</li>
            ))}
        </ul>
      )}
    </Dialog>
  )
}
