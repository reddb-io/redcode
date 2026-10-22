/** @jsxImportSource react */
import { useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import type { SharedSource } from "@/runtime/react/source"
import type { SharedLanguage } from "@/runtime/react/language"

export function DeleteHomeSessionDialog(props: {
  source: SharedSource<{ language: SharedLanguage; open: boolean; name: string }>
  confirm: () => Promise<void>
  close: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={view.open}
      title={view.language.t("session.delete.title")}
      description={view.language.t("session.delete.confirm", { name: view.name })}
      showClose={false}
      dismissible={!busy}
      className="h-fit"
      onOpenChange={(open) => {
        if (!open && !busy) props.close()
      }}
      actions={() => (
        <>
          <Button variant="ghost" disabled={busy} onClick={props.close}>
            {view.language.t("common.cancel")}
          </Button>
          <Button
            tone="danger"
            loading={busy}
            onClick={() => {
              setBusy(true)
              void props.confirm().finally(() => setBusy(false))
            }}
          >
            {view.language.t("session.delete.button")}
          </Button>
        </>
      )}
    />
  )
}
