import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { NativeServerRowMenu } from "./menus.react"
import { type Component } from "solid-js"
import type { ServerActionsController } from "@/servers/registry/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"

export const ServerRowMenu: Component<{
  server: ServerConnection.Any
  domain: ServerActionsController
  onEdit: (server: ServerConnection.Http) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}> = (props) => {
  const language = useLanguage()
  const key = ServerConnection.key(props.server)

  return (
    <ServerRowMenuView
      server={props.server}
      labels={serverMenuLabels(language)}
      canRemove={props.domain.connection.canRemove(key)}
      canHide={props.domain.connection.canHide(key)}
      hidden={props.domain.connection.isHidden(key)}
      onEdit={props.onEdit}
      onRemove={() => props.domain.connection.remove(key)}
      onHide={() => props.domain.connection.setHidden(key, true)}
      onShow={() => props.domain.connection.setHidden(key, false)}
      open={props.open}
      onOpenChange={props.onOpenChange}
    />
  )
}

export function serverMenuLabels(language: ReturnType<typeof useLanguage>) {
  return {
    more: language.t("common.moreOptions"),
    server: language.t("settings.section.server"),
    edit: language.t("dialog.server.menu.edit"),
    remove: language.t("dialog.server.menu.remove"),
    hide: language.t("dialog.server.menu.hide"),
    show: language.t("dialog.server.menu.show"),
  }
}

type ServerRowMenuViewProps = {
  server: ServerConnection.Any
  labels: ReturnType<typeof serverMenuLabels>
  canRemove: boolean
  canHide?: boolean
  hidden?: boolean
  onEdit: (server: ServerConnection.Http) => void
  onRemove: () => void
  onHide?: () => void
  onShow?: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function createServerRowMenuServices(props: ServerRowMenuViewProps) {
  return {
    snapshot: sharedSource(() => ({
      labels: { ...props.labels },
      canEdit: !ServerConnection.builtin(props.server) && props.server.type === "http",
      canRemove: props.canRemove,
      canHide: !!props.canHide,
      hidden: !!props.hidden,
      open: props.open,
    })),
    edit: () => {
      if (props.server.type === "http") props.onEdit(props.server)
    },
    remove: () => props.onRemove(),
    hide: () => props.onHide?.(),
    show: () => props.onShow?.(),
    open: (open: boolean) => props.onOpenChange?.(open),
  }
}

export function ServerRowMenuView(props: ServerRowMenuViewProps) {
  const services = createServerRowMenuServices(props)
  return <ReactView component={NativeServerRowMenu} props={{ services }} />
}
