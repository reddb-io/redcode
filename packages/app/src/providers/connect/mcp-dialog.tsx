import { createMemo } from "solid-js"
import { useData } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"
import { useMcpToggle } from "@/providers/connect/mcp"
import { useNativeDialog } from "@/runtime/react/dialog"
import { sharedSource } from "@/runtime/react/source"
import { sharedLanguage } from "@/runtime/react/language"
import { ReactView } from "@/runtime/react/view"
import { McpDialog } from "./mcp-dialog.react"

export function DialogSelectMcp() {
  const data = useData()
  const sdk = useWorkspaceLocation()
  const language = useLanguage()
  const modal = useNativeDialog()
  const toggle = useMcpToggle(() => sdk().directory)
  const items = createMemo(() =>
    (data.location.mcp.server.list({ directory: sdk().directory }) ?? [])
      .map((server) => ({
        name: server.name,
        status: server.status.status,
        error: server.status.status === "failed" ? server.status.error : undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
  const source = sharedSource(() => ({
    language: sharedLanguage(language),
    open: modal.open(),
    items: items(),
    busy: toggle.isPending && typeof toggle.variables === "string" ? toggle.variables : undefined,
  }))
  return (
    <ReactView
      component={McpDialog}
      props={{
        source,
        close: modal.close,
        toggle: (name: string) => {
          if (toggle.isPending || items().find((item) => item.name === name)?.status === "pending") return
          toggle.mutate(name)
        },
      }}
    />
  )
}
