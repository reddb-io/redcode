import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { ReasoningAuto } from "@reddb-io/redcode-core/session/reasoning-auto"
import { modeID } from "../util/model-origin"

export function DialogVariant() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()

  const model = createMemo(() => {
    const current = local.model.current()
    if (!current) return undefined
    return sync.data.provider.find((item) => item.id === current.providerID)?.models[current.modelID]
  })

  const options = createMemo(() => {
    const info = model()
    return [
      {
        value: "default",
        title: "Default",
        onSelect: () => {
          dialog.clear()
          local.model.variant.set(undefined)
        },
      },
      ...local.model.variant.list().map((variant) => {
        // A router mode (review) is requested under its own id at the router.
        const mode = info && modeID(info, variant)
        return {
          value: variant,
          title: variant === ReasoningAuto.AUTO ? "Auto" : variant,
          ...(variant === ReasoningAuto.AUTO ? { description: "effort follows each turn" } : {}),
          ...(mode ? { description: `mode · ${mode}` } : {}),
          onSelect: () => {
            dialog.clear()
            local.model.variant.set(variant)
          },
        }
      }),
    ]
  })

  return (
    <DialogSelect<string>
      options={options()}
      title={"Select variant"}
      current={local.model.variant.selected()}
      flat={true}
    />
  )
}
