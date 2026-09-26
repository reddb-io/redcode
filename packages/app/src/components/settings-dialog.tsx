import { useParams } from "@solidjs/router"
import { onCleanup } from "solid-js"
import { useCommand } from "@/context/command"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"

export function useSettingsDialog(defaultValue?: string) {
  const dialog = useDialog()
  const params = useParams<{ id?: string }>()
  let run = 0
  let dead = false

  onCleanup(() => {
    dead = true
  })

  return () => {
    const current = ++run
    const sessionID = params.id
    void import("@/components/settings-v2").then((module) => {
      if (dead || run !== current) return
      void dialog.show(() => <module.DialogSettings sessionID={sessionID} defaultValue={defaultValue} />)
    })
  }
}

export function useSettingsCommand() {
  const command = useCommand()
  const show = useSettingsDialog()

  command.register("settings", () => [
    {
      id: "settings.open",
      title: "Open settings",
      category: "Settings",
      keybind: "mod+comma",
      onSelect: show,
    },
  ])

  return show
}
