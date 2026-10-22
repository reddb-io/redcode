/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Icon } from "@/runtime/react/icon.react"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedSource } from "@/runtime/react/source"
import { ModelListView } from "./list.react"
import { ChatGPTPlan } from "./popover.react"
import type { createModelListServices } from "./select-dialog"

export function ModelDrawerBody(props: {
  source: SharedSource<{ language: SharedLanguage; canConnect: boolean; chatgptPlan: boolean }>
  list: ReturnType<typeof createModelListServices>
  manage: () => void
  connect: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  return (
    <>
      <div className="flex min-h-0 flex-col">
        <ModelListView services={props.list} />
      </div>
      <div data-slot="model-selector-actions" className="flex flex-col gap-2">
        <Button variant="ghost" className="h-10 w-full justify-start" onClick={props.manage}>
          <Icon name="outline-sliders" />
          {view.language.t("dialog.model.manage")}
        </Button>
        {view.canConnect && (
          <Button variant="ghost" className="h-10 w-full justify-start" onClick={props.connect}>
            <Icon name="plus" />
            {view.language.t("command.provider.connect")}
          </Button>
        )}
        {view.chatgptPlan && <ChatGPTPlan language={view.language} />}
      </div>
    </>
  )
}
