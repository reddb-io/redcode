/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { LoadingIndicator } from "@reddb-io/design-system/base/LoadingIndicator"
import { Icon } from "@/runtime/react/icon.react"
import type { createServerHealthSource } from "./row"

export function NativeServerHealth(props: { source: ReturnType<typeof createServerHealthSource> }) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  if (view.authenticationRequired)
    return (
      <span
        role="status"
        aria-label={view.language.t("server.status.authentication")}
        className="inline-flex h-3.5 w-1.5 shrink-0 items-center justify-center text-ink-muted"
      >
        <Icon name="lock" size="small" />
      </span>
    )
  if (view.connecting || view.health?.checking)
    return <LoadingIndicator size="sm" label={view.language.t("server.status.connecting")} />
  if (view.health?.incompatible)
    return <Icon name="warning" size="small" className="shrink-0 text-feedback-warning-foreground" />
  return (
    <span
      className={`my-[3.5px] size-1.5 shrink-0 rounded-full ${view.health?.healthy ? "bg-feedback-success-foreground" : view.health?.healthy === false ? "bg-feedback-danger-foreground" : "bg-muted"}`}
    />
  )
}
