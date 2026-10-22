/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Popover } from "@reddb-io/design-system/base/Popover"
import { Icon } from "@/runtime/react/icon.react"
import { ProviderModelIcon } from "@/settings/providers/provider-icon.react"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedSource } from "@/runtime/react/source"
import { ModelListView } from "./list.react"
import type { createModelListServices } from "./select-dialog"

export function ModelTriggerButton(props: {
  provider?: { id: string; canonical?: string }
  label: string
  className?: string
  open?: boolean
  kind?: "dialog" | "drawer"
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={props.className}
      aria-label={props.label}
      aria-haspopup="dialog"
      aria-expanded={props.open}
      data-action="composer-model"
      data-control-type={props.kind ?? "drawer"}
      onClick={props.onClick}
    >
      <ModelTriggerContent label={props.label} provider={props.provider} />
    </Button>
  )
}

export function ModelPopoverView(props: {
  source: SharedSource<{
    language: SharedLanguage
    label: string
    provider: { id: string; canonical?: string } | undefined
    triggerClass: string | undefined
    chatgptPlan: boolean
    refreshing: boolean
  }>
  services: ReturnType<typeof createModelListServices>
  refresh: () => void
  connect: () => void
  manage: () => void
  close: () => void
  onOpenChange: (open: boolean) => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLDivElement>(null)
  const pending = useRef<(() => void) | undefined>(undefined)
  const changeOpen = (open: boolean) => {
    props.onOpenChange(open)
    setOpen(open)
  }
  useLayoutEffect(() => {
    // Retain the composer's command target on the DS-owned trigger.
    const button = trigger.current?.querySelector("button[data-popover-trigger]")
    button?.setAttribute("data-action", "composer-model")
    button?.setAttribute("data-control-type", "popover")
  }, [])
  useEffect(() => {
    if (open || !pending.current) return
    const action = pending.current
    pending.current = undefined
    queueMicrotask(action)
  }, [open])
  const closeThen = (action: () => void) => {
    pending.current = action
    changeOpen(false)
  }
  return (
    <div ref={trigger} className="contents">
      <Popover
        triggerLabel={view.label}
        contentLabel={view.language.t("dialog.model.select.title")}
        open={open}
        onOpenChange={changeOpen}
        variant="ghost"
        size="sm"
        side="top"
        sideOffset={6}
        triggerClass={view.triggerClass}
        trigger={<ModelTriggerContent label={view.label} provider={view.provider} />}
        className="flex overflow-hidden max-h-[min(560px,calc(100dvh-32px))] w-[340px] max-w-[calc(100vw-16px)] flex-col p-1"
      >
        {open && (
          <ModelListView
            services={props.services}
            menu
            select={(item) => closeThen(() => props.services.select(item))}
            escape={() => closeThen(props.close)}
            actions={[
              {
                key: "action:refresh",
                label: view.language.t(view.refreshing ? "dialog.model.refresh.pending" : "dialog.model.refresh"),
                icon: "reset",
                disabled: view.refreshing,
                run: props.refresh,
              },
              {
                key: "action:connect",
                label: view.language.t("command.provider.connect"),
                icon: "plus",
                run: () => closeThen(props.connect),
              },
              {
                key: "action:manage",
                label: view.language.t("dialog.model.manage"),
                icon: "outline-sliders",
                run: () => closeThen(props.manage),
              },
            ]}
          />
        )}
        {view.chatgptPlan && <ChatGPTPlan language={view.language} />}
      </Popover>
    </div>
  )
}

export function ChatGPTPlan(props: { language: SharedLanguage }) {
  return (
    <div className="flex min-h-10 items-center gap-2 border-t border-muted px-3 py-2 text-body text-foreground">
      <ProviderModelIcon provider={{ id: "openai" }} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{props.language.t("dialog.model.chatgptPlan")}</span>
      <a
        href="https://chatgpt.com/settings/usage"
        target="_blank"
        rel="noopener noreferrer"
        className="flex shrink-0 items-center gap-1 rounded-sm text-ink-muted no-underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus"
      >
        {props.language.t("dialog.model.chatgptManageUsage")}
        <Icon name="arrow-up-right" size="small" />
      </a>
    </div>
  )
}

function ModelTriggerContent(props: { label: string; provider?: { id: string; canonical?: string } }) {
  return (
    <>
      {props.provider && (
        <ProviderModelIcon
          provider={props.provider}
          className="shrink-0 opacity-40 transition-opacity duration-150 group-hover:opacity-100"
        />
      )}
      <span className="truncate leading-4">{props.label}</span>
      <span className="-ml-0.5 -mr-1 flex shrink-0">
        <Icon name="chevron-down" />
      </span>
    </>
  )
}
