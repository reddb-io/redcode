import { useWorkspaceLocation } from "@/workspaces/location"
import { ReactView } from "@/runtime/react/view"
import { createExtensionsServices } from "../providers/extensions"
import { Extensions } from "../providers/extensions.react"
import type { SettingsView } from "../route"

export function ProjectSettingsExtensions(props: {
  subtab?: SettingsView["subtab"]
  onSubtab: (value: "mcps" | "plugins" | "skills" | "lsps") => void
}) {
  const location = useWorkspaceLocation()
  const services = createExtensionsServices(
    {
      get subtab() {
        return props.subtab
      },
      onSubtab(value) {
        if (value && value !== "tools") props.onSubtab(value)
      },
    },
    () => location().directory,
  )
  return <ReactView component={Extensions} props={{ services }} />
}
