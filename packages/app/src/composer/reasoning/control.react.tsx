/** @jsxImportSource react */
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Popover } from "@reddb-io/design-system/base/Popover"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import { Icon } from "@/runtime/react/icon.react"
import type { createReasoningControlServices } from "./control"
import { ReasoningChoices } from "./choices.react"

export function ReasoningControl(props: { services: ReturnType<typeof createReasoningControlServices> }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const [open, setOpen] = useState(false)
  const pending = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    if (open || !pending.current) return
    const action = pending.current
    pending.current = undefined
    queueMicrotask(action)
  }, [open])
  if (!view.visible) return null
  const label = view.language.t(view.setup ? "composer.reasoning.setup" : "composer.reasoning.title")
  const content = (
    <>
      <Icon name="brain" size="small" className="shrink-0" />
      <span className="truncate leading-5">{view.label}</span>
    </>
  )
  const tooltip = [
    view.language.t("composer.reasoning.title"),
    view.evaluator,
    view.draft ? view.language.t("composer.reasoning.draft") : undefined,
  ]
    .filter(Boolean)
    .join("\n")
  return (
    <Tooltip
      content={tooltip}
      child={({ props: trigger }) => (
        <span {...trigger} className="inline-flex min-w-0 max-w-[220px]">
          {view.setup ? (
            <Button variant="ghost" size="sm" aria-label={label} onClick={services.setup}>
              {content}
            </Button>
          ) : (
            <Popover
              open={open}
              onOpenChange={setOpen}
              triggerLabel={label}
              contentLabel={label}
              variant="ghost"
              size="sm"
              side="top"
              align="start"
              sideOffset={6}
              triggerClass={`max-w-full justify-start gap-1.5 font-medium ${view.tone === "warning" ? "text-feedback-warning-foreground" : view.tone === "info" ? "text-feedback-info-foreground" : ""}`}
              trigger={
                <>
                  {content}
                  <Icon name="chevron-down" />
                </>
              }
              className="w-max max-w-[calc(100vw-32px)] p-1"
            >
              {open && (
                <ReasoningChoices
                  label={label}
                  items={view.choices}
                  value={view.choice}
                  select={(choice) => {
                    setOpen(false)
                    services.select(choice)
                  }}
                  status={{
                    label: view.language.t("command.reasoning.status"),
                    run: () => {
                      pending.current = services.status
                      setOpen(false)
                    },
                  }}
                />
              )}
            </Popover>
          )}
        </span>
      )}
    />
  )
}
