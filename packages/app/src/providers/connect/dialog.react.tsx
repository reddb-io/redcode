/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Icon } from "@/runtime/react/icon.react"
import { SharedSlot } from "@/runtime/react/slot.react"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedMount } from "@/runtime/react/mount"
import type { SharedSource } from "@/runtime/react/source"
import { ProviderModelIcon } from "@/settings/providers/provider-icon.react"

export function ConnectProviderDialog(props: {
  source: SharedSource<{
    language: SharedLanguage
    open: boolean
    selected: string | undefined
    consoleSelected: boolean
    modelProvider: { id: string; name: string } | undefined
    authorization: boolean
    title: string
  }>
  content: SharedMount
  close: () => void
  back: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const sized = !!view.modelProvider || !view.selected || (view.consoleSelected && !view.authorization)
  return (
    <Dialog
      open={view.open}
      title={view.title}
      showClose={false}
      dismissible={!view.authorization}
      className={`w-[min(calc(100vw-16px),640px)] max-w-none max-h-[min(calc(100dvh-16px),560px)] [&_[data-dialog-body]]:flex [&_[data-dialog-body]]:flex-col [&_[data-dialog-body]]:overflow-hidden ${sized ? "h-[min(calc(100dvh-16px),560px)]" : "h-fit"}`}
      header={() => (
        <div className="flex items-center gap-2 pb-5">
          {view.selected && !view.modelProvider && (
            <Button variant="ghost" size="sm" aria-label={view.language.t("common.goBack")} onClick={props.back}>
              <Icon name="arrow-left" />
            </Button>
          )}
          {view.modelProvider && <ProviderModelIcon provider={view.modelProvider} className="shrink-0" />}
          <span className="min-w-0 flex-1 text-heading">
            {!view.selected || view.modelProvider ? view.title : undefined}
          </span>
          <Button variant="ghost" size="sm" aria-label={view.language.t("common.close")} onClick={props.close}>
            <Icon name="xmark-small" />
          </Button>
        </div>
      )}
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
    >
      <SharedSlot mount={props.content} className="flex min-h-0 flex-1 flex-col" />
    </Dialog>
  )
}
