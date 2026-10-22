import type { Icon } from "@opencode/ui/icon"
import type { ComponentProps, JSX } from "solid-js"
import { getOwner, runWithOwner } from "solid-js"
import { useSettingsSurface } from "./surface"
import { sharedSource } from "@/runtime/react/source"
import { sharedMount } from "@/runtime/react/mount"
import { ReactView } from "@/runtime/react/view"
import { createSettingsSearchServices } from "./search"
import { SettingsNavigationView } from "./navigation.react"
import "./search.css"

export type SettingsNavItem = {
  value: string
  label: string
  icon: ComponentProps<typeof Icon>["name"]
  disabled?: boolean
  onPrefetch?: () => void
}

export type SettingsNavGroup = {
  label?: string
  action?: JSX.Element
  items: readonly SettingsNavItem[]
}

export function SettingsNavigation(props: {
  value: string
  groups: readonly SettingsNavGroup[]
  backLabel: string
  onBack: () => void
  onChange: (value: string) => void
  mobileAction?: JSX.Element
  children: JSX.Element
}) {
  const surface = useSettingsSurface()
  const services = createSettingsSearchServices()
  const owner = getOwner()
  const actions = new Map<number, ReturnType<typeof sharedMount>>()
  const source = sharedSource(() => ({
    value: props.value,
    backLabel: props.backLabel,
    searchable: surface.view().type === "root",
    groups: props.groups.map((group, index) => {
      if (group.action && !actions.has(index))
        runWithOwner(owner, () =>
          actions.set(
            index,
            sharedMount(() => props.groups[index]?.action),
          ),
        )
      return { ...group, action: group.action ? actions.get(index) : undefined }
    }),
  }))
  const content = sharedMount(() => props.children)
  const mobileAction = sharedMount(() => props.mobileAction)
  return (
    <ReactView
      component={SettingsNavigationView}
      props={{ source, services, onBack: props.onBack, onChange: props.onChange, content, mobileAction }}
    />
  )
}
