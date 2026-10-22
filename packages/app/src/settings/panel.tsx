import { Show, type JSX } from "solid-js"
import { ReactView } from "@/runtime/react/view"
import { sharedMount } from "@/runtime/react/mount"
import { useSettingsSurface } from "./surface"
import { SettingsPanelView } from "./panel.react"

/** Retain page-scoped application services until their surrounding providers migrate. */
export function SettingsPanel(props: { value: string; class?: string; children: JSX.Element }) {
  const surface = useSettingsSurface()
  const content = sharedMount(() => props.children)
  return (
    <Show when={surface.view().tab === props.value}>
      <ReactView component={SettingsPanelView} props={{ value: props.value, className: props.class, content }} />
    </Show>
  )
}
