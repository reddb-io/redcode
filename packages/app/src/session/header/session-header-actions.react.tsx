/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import { toggleButton } from "@reddb-io/design-system/base/recipes"
import { Icon } from "@/runtime/react/icon.react"
import type { createSessionPanelServices, createSessionHeaderActionsServices } from "./session-header-actions"

type Services = ReturnType<typeof createSessionPanelServices>
type Toggle = ReturnType<Services["snapshot"]["getSnapshot"]>["toggles"][number]

export function SessionPanelTogglesView(props: { services: Services }) {
  const view = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  return (
    <div role="toolbar" aria-label={view.label} className="flex items-center gap-0.5">
      {view.toggles.map((toggle) => (
        <PanelToggleButton key={toggle.id} toggle={toggle} />
      ))}
      <div className="mx-1 h-4 w-px bg-muted" aria-hidden="true" />
      <PanelToggleButton toggle={view.side} />
    </div>
  )
}

function PanelToggleButton(props: { toggle: Toggle }) {
  const toggle = props.toggle
  return (
    <Tooltip
      content={[toggle.label, toggle.keys.join(" ")].filter(Boolean).join(" · ")}
      child={({ props: trigger }) => (
        <Button
          {...trigger}
          variant="ghost"
          size="sm"
          data-action={`session-toggle-${toggle.id}`}
          aria-label={toggle.label}
          aria-pressed={toggle.pressed}
          aria-controls={toggle.controls}
          className={toggleButton({
            pressed: toggle.pressed,
            class: "size-7 shrink-0 justify-center rounded-md border-b-2 border-b-transparent p-0",
          })}
          onClick={toggle.run}
        >
          <Icon name={toggle.icon} />
        </Button>
      )}
    />
  )
}

export function SessionHeaderActionsView(props: { services: ReturnType<typeof createSessionHeaderActionsServices> }) {
  const view = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  return (
    <div className="flex items-center gap-2">
      {view.reviewVisible && (
        <Tooltip
          content={[view.reviewLabel, view.reviewKeybind.join(" ")].filter(Boolean).join(" · ")}
          child={({ props: trigger }) => (
            <Button
              {...trigger}
              variant="ghost"
              size="sm"
              className="size-8 shrink-0 p-0 aria-expanded:bg-foreground/10"
              aria-label={view.reviewLabel}
              aria-expanded={view.reviewOpened}
              aria-controls="review-panel"
              data-state={view.reviewOpened ? "pressed" : undefined}
              onClick={props.services.toggle}
            >
              <Icon name="sidebar-right" />
            </Button>
          )}
        />
      )}
    </div>
  )
}
