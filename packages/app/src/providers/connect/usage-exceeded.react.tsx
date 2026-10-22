/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { DialogHeader } from "@/runtime/react/dialog-header.react"
import { SharedSlot } from "@/runtime/react/slot.react"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedMount } from "@/runtime/react/mount"
import type { SharedSource } from "@/runtime/react/source"

export function UsageExceededDialog(props: {
  source: SharedSource<{ language: SharedLanguage; open: boolean; title: string; actionLabel: string }>
  description: SharedMount
  action: () => void
  dismiss: () => void
  close: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  return (
    <Dialog
      open={view.open}
      title={view.title}
      showClose={false}
      header={() => <DialogHeader title={view.title} language={view.language} close={props.close} />}
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
    >
      <div className="flex flex-col gap-5">
        <SharedSlot mount={props.description} className="text-body text-ink-muted" />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={props.dismiss}>
            {view.language.t("dialog.usageExceeded.dontShowAgain")}
          </Button>
          <Button variant="primary" onClick={props.action}>
            {view.actionLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
