/** @jsxImportSource react */
import type { SharedMount } from "@/runtime/react/mount"
import { SharedSlot } from "@/runtime/react/slot.react"

export function SettingsPanelView(props: { value: string; className?: string; content: SharedMount }) {
  return (
    <div
      id={`settings-panel-${props.value}`}
      role="tabpanel"
      aria-labelledby={`settings-tab-${props.value}`}
      tabIndex={0}
      data-slot="tabs-v2-content"
      data-value={props.value}
      className={props.className}
    >
      <SharedSlot mount={props.content} />
    </div>
  )
}
