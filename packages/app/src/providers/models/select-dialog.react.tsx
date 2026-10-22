/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import { Icon } from "@/runtime/react/icon.react"
import { DialogHeader } from "@/runtime/react/dialog-header.react"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedSource } from "@/runtime/react/source"
import { ModelListView } from "./list.react"
import type { createModelListServices } from "./select-dialog"

export function ModelSelectionDialog(props: {
  source: SharedSource<{
    language: SharedLanguage
    open: boolean
    variants: boolean
    title: string
    modelName: string | undefined
    choices: string[]
    current: string
    refreshing: boolean
  }>
  services: ReturnType<typeof createModelListServices>
  close: () => void
  refresh: () => void
  connect: () => void
  manage: () => void
  selectVariant: (value: string) => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  return (
    <Dialog
      open={view.open}
      title={view.title}
      size="lg"
      showClose={false}
      description={view.variants ? view.modelName : undefined}
      className="h-[min(640px,calc(100dvh-32px))] [&_[data-dialog-body]]:flex [&_[data-dialog-body]]:flex-col [&_[data-dialog-body]]:overflow-hidden"
      header={() => (
        <>
          <DialogHeader title={view.title} language={view.language} close={props.close} />
          {!view.variants && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button variant="ghost" disabled={view.refreshing} aria-busy={view.refreshing} onClick={props.refresh}>
                <Icon name="reset" />
                {view.language.t(view.refreshing ? "dialog.model.refresh.pending" : "dialog.model.refresh")}
              </Button>
              <Button variant="secondary" onClick={props.connect}>
                <Icon name="plus" />
                {view.language.t("command.provider.connect")}
              </Button>
            </div>
          )}
        </>
      )}
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
    >
      {view.variants ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {view.choices.map((value, index) => (
            <ListRow
              key={value}
              autoFocus={index === 0}
              selected={view.current === value}
              aria-pressed={view.current === value}
              title={value === "default" ? view.language.t("dialog.model.variant.default") : value}
              onClick={() => props.selectVariant(value)}
              trailing={view.current === value && <Icon name="check" size="small" />}
            />
          ))}
        </div>
      ) : (
        <>
          <ModelListView services={props.services} escape={props.close} />
          <div className="flex shrink-0 items-center gap-3 border-t border-muted pt-3">
            <Button variant="ghost" className="min-w-0 flex-1 justify-start" onClick={props.manage}>
              <Icon name="outline-sliders" />
              {view.language.t("dialog.model.manage")}
            </Button>
            <span className="shrink-0 text-caption text-ink-muted">
              {view.language.t("dialog.model.favorite.hint")}
            </span>
          </div>
        </>
      )}
    </Dialog>
  )
}
