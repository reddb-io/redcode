/** @jsxImportSource react */
import { useRef, useState, useSyncExternalStore } from "react"
import fuzzysort from "fuzzysort"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Input } from "@reddb-io/design-system/base/Input"
import { Switch } from "@reddb-io/design-system/base/Switch"
import { DialogHeader } from "@/runtime/react/dialog-header.react"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedSource } from "@/runtime/react/source"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

export function McpDialog(props: {
  source: SharedSource<{
    language: SharedLanguage
    open: boolean
    items: { name: string; status: string; error: string | undefined }[]
    busy: string | undefined
  }>
  close: () => void
  toggle: (name: string) => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const language = view.language
  const [query, setQuery] = useState("")
  const list = useRef<HTMLUListElement>(null)
  const items = query
    ? fuzzysort
        .go(query, view.items, { keys: ["name", "status"] })
        .map((result) => result.obj)
        .sort((a, b) => a.name.localeCompare(b.name))
    : view.items
  const move = (direction: 1 | -1) => {
    const controls = [...(list.current?.querySelectorAll<HTMLInputElement>("input:not(:disabled)") ?? [])]
    const current = controls.findIndex((control) => control === document.activeElement)
    const next =
      current < 0
        ? direction === 1
          ? 0
          : controls.length - 1
        : (current + direction + controls.length) % controls.length
    controls[next]?.focus()
  }
  return (
    <Dialog
      open={view.open}
      title={language.t("dialog.mcp.title")}
      description={language.t("dialog.mcp.description", {
        enabled: view.items.filter((item) => item.status === "connected").length,
        total: view.items.length,
      })}
      header={() => <DialogHeader title={language.t("dialog.mcp.title")} language={language} close={props.close} />}
      showClose={false}
      className="max-h-[calc(100dvh-32px)]"
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
    >
      <div className="flex min-h-0 flex-col gap-3">
        <Input
          type="text"
          aria-label={language.t("common.search.placeholder")}
          placeholder={language.t("common.search.placeholder")}
          value={query}
          onValueChange={setQuery}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              move(event.key === "ArrowDown" ? 1 : -1)
            }
            if (event.key !== "Enter" || event.nativeEvent.isComposing || !items[0]) return
            event.preventDefault()
            props.toggle(items[0].name)
          }}
        />
        <ul
          ref={list}
          className="flex min-h-0 flex-col divide-y divide-elevation-base-border overflow-y-auto"
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
            event.preventDefault()
            move(event.key === "ArrowDown" ? 1 : -1)
          }}
        >
          {items.map((item) => (
            <li key={item.name} className="py-3">
              <Switch
                label={item.name}
                help={
                  item.status in statusLabels
                    ? language.t(statusLabels[item.status as keyof typeof statusLabels])
                    : undefined
                }
                error={item.error}
                checked={item.status === "connected"}
                disabled={item.status === "pending" || view.busy === item.name}
                onCheckedChange={() => props.toggle(item.name)}
              />
            </li>
          ))}
        </ul>
        {!items.length && (
          <p role="status" className="text-body text-ink-muted">
            {language.t("dialog.mcp.empty")}
          </p>
        )}
      </div>
    </Dialog>
  )
}
