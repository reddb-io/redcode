import { useWorkspaceLocation } from "@/workspaces/location"
import { ReactView } from "@/runtime/react/view"
import { createExtensionsServices } from "../providers/extensions"
import { Extensions } from "../providers/extensions.react"

export function ProjectSettingsExtensions(props: {
  subtab?: "mcps" | "plugins" | "skills" | "lsps"
  onSubtab: (value: "mcps" | "plugins" | "skills" | "lsps") => void
}) {
  const location = useWorkspaceLocation()
  const services = createExtensionsServices(
    {
      get subtab() {
        return props.subtab
      },
      onSubtab(value) {
        if (value) props.onSubtab(value)
      },
    },
    () => location().directory,
  )
  return <ReactView component={Extensions} props={{ services }} />
}
