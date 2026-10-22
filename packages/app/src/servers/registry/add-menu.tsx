import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { NativeAddServerMenu } from "./menus.react"
import { useServerAddItems } from "@/runtime/extension/servers"
import { useLanguage } from "@/runtime/i18n/language"

type AddServerMenuProps = {
  onAddServer: () => void
  onConnected?: (key: string) => void
  compact?: boolean
}

export function createAddServerMenuServices(props: AddServerMenuProps) {
  const language = useLanguage()
  const items = useServerAddItems()
  return {
    snapshot: sharedSource(() => ({
      label: language.t("dialog.server.add.button"),
      compact: !!props.compact,
      items: items().map((item, index) => ({
        id: `${item.id}:${index}`,
        label: item.title,
        onselect: () => item.run({ onConnected: props.onConnected }),
      })),
    })),
    add: () => props.onAddServer(),
  }
}

/** The add-server action retains extension kinds through the native DS menu. */
export function AddServerMenu(props: AddServerMenuProps) {
  const services = createAddServerMenuServices(props)
  return <ReactView component={NativeAddServerMenu} props={{ services }} />
}
