import type { ServerHealth } from "@/runtime/server/health"
import { useLanguage } from "@/runtime/i18n/language"
import { sharedLanguage } from "@/runtime/react/language"
import { sharedSource } from "@/runtime/react/source"
import { ReactView } from "@/runtime/react/view"
import { NativeServerHealth } from "./health.react"

export function createServerHealthSource(props: {
  health?: ServerHealth
  connecting?: boolean
  authenticationRequired?: boolean
}) {
  const language = useLanguage()
  return sharedSource(() => ({
    language: sharedLanguage(language),
    health: props.health ? { ...props.health } : undefined,
    connecting: !!props.connecting,
    authenticationRequired: !!props.authenticationRequired,
  }))
}

export function ServerHealthIndicator(props: {
  health?: ServerHealth
  connecting?: boolean
  authenticationRequired?: boolean
}) {
  const source = createServerHealthSource(props)
  return <ReactView component={NativeServerHealth} props={{ source }} />
}
