import type { PermissionRequest } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { SessionPermissionDockView } from "./session-permission-dock.react"

export function createSessionPermissionServices(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  return {
    snapshot: sharedSource(() => {
      const key = `settings.permissions.tool.${props.request.action}.description`
      const description = language.t(key as Parameters<typeof language.t>[0])
      return {
        language: sharedLanguage(language),
        description: description === key ? "" : description,
        resources: [...props.request.resources],
        responding: props.responding,
      }
    }),
    decide: (response: "once" | "always" | "reject") => props.onDecide(response),
  }
}

export function SessionPermissionDock(props: Parameters<typeof createSessionPermissionServices>[0]) {
  const services = createSessionPermissionServices(props)
  return <ReactView component={SessionPermissionDockView} props={{ services }} />
}
