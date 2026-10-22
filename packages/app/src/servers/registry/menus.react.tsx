/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { DropdownMenu } from "@reddb-io/design-system/base/DropdownMenu"
import { Icon } from "@/runtime/react/icon.react"
import type { createServerRowMenuServices } from "./row-menu"
import type { createAddServerMenuServices } from "./add-menu"

export function NativeServerRowMenu(props: { services: ReturnType<typeof createServerRowMenuServices> }) {
  const view = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  return (
    <DropdownMenu
      triggerLabel={view.labels.more}
      contentLabel={view.labels.more}
      open={view.open}
      onOpenChange={props.services.open}
      trigger={<Icon name="outline-dots" />}
      variant="ghost"
      size="sm"
      align="end"
      sideOffset={6}
      items={[
        {
          heading: view.labels.server,
          items: [
            { id: "edit", label: view.labels.edit, disabled: !view.canEdit, onselect: props.services.edit },
            ...(view.hidden
              ? [{ id: "show", label: view.labels.show, onselect: props.services.show }]
              : view.canHide
                ? [{ id: "hide", label: view.labels.hide, onselect: props.services.hide }]
                : []),
          ],
        },
        ...(view.canRemove
          ? [{ items: [{ id: "remove", label: view.labels.remove, onselect: props.services.remove }] }]
          : []),
      ]}
    />
  )
}

export function NativeAddServerMenu(props: { services: ReturnType<typeof createAddServerMenuServices> }) {
  const view = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  const content = (
    <>
      <Icon name="plus" />
      {!view.compact && view.label}
    </>
  )
  if (!view.items.length)
    return (
      <Button variant="ghost" size={view.compact ? "sm" : "md"} aria-label={view.label} onClick={props.services.add}>
        {content}
      </Button>
    )
  return (
    <DropdownMenu
      triggerLabel={view.label}
      contentLabel={view.label}
      trigger={content}
      variant="ghost"
      size={view.compact ? "sm" : "md"}
      align="end"
      sideOffset={4}
      items={[{ id: "http", label: view.label, onselect: props.services.add }, ...view.items]}
    />
  )
}
