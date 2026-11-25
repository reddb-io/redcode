import { DialogAction, DialogMessage } from "./dialog-message"
import { Keymap } from "../context/keymap"
import { useDialog } from "./dialog"
import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { Locale } from "../util/locale"

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  label?: {
    confirm?: string
    cancel?: string
  }
}

export function DialogConfirm(props: DialogConfirmProps) {
  const dialog = useDialog()
  const [store, setStore] = createStore({
    active: "confirm" as "confirm" | "cancel",
  })

  const select = (key: "confirm" | "cancel") => {
    if (key === "confirm") props.onConfirm?.()
    if (key === "cancel") props.onCancel?.()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: "Confirm dialog selection",
        group: "Dialog",
        run: () => select(store.active),
      },
      {
        bind: "left",
        title: "Previous dialog option",
        group: "Dialog",
        run: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm")
        },
      },
      {
        bind: "right",
        title: "Next dialog option",
        group: "Dialog",
        run: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm")
        },
      },
    ],
  }))
  return (
    <DialogMessage title={props.title} message={props.message}>
      <For each={["cancel", "confirm"] as const}>
        {(key) => (
          <DialogAction
            focused={key === store.active}
            label={Locale.titlecase(props.label?.[key] ?? key)}
            onPress={() => select(key)}
          />
        )}
      </For>
    </DialogMessage>
  )
}
