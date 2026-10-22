/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Select } from "@reddb-io/design-system/base/Select"
import type { SharedMount } from "@/runtime/react/mount"
import { SharedSlot } from "@/runtime/react/slot.react"
import type { SharedSource } from "@/runtime/react/source"
import { SettingsIcon } from "./icon.react"
import { SettingsSearch } from "./search.react"
import type { createSettingsSearchServices } from "./search"
import type { SettingsNavItem } from "./navigation"

export function SettingsNavigationView(props: {
  source: SharedSource<{
    value: string
    groups: { label?: string; action?: SharedMount; items: readonly SettingsNavItem[] }[]
    backLabel: string
    searchable: boolean
  }>
  services: ReturnType<typeof createSettingsSearchServices>
  onBack: () => void
  onChange: (value: string) => void
  mobileAction: SharedMount
  content: SharedMount
}) {
  const state = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const search = useSyncExternalStore(props.services.search.source.subscribe, props.services.search.source.getSnapshot)
  const snapshot = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  const items = state.groups.flatMap((group) => group.items)
  const change = (value: string) => {
    props.services.search.clear()
    props.onChange(value)
  }
  const back = () => {
    if (!state.searchable && props.services.search.back()) return
    props.onBack()
  }
  const backLabel =
    !state.searchable && search.selected ? snapshot.language.t("settings.backToSettings") : state.backLabel
  return (
    <div className="settings" data-component="tabs-v2" data-variant="settings" data-orientation="vertical">
      <div className="settings-mobile-nav">
        <button type="button" className="settings-back" onClick={back}>
          <SettingsIcon name="arrow-left" size="small" className="settings-back-icon" />
          <span>{backLabel}</span>
        </button>
        <div className="settings-mobile-actions">
          <SharedSlot mount={props.mobileAction} />
          <Select
            className="settings-mobile-menu-trigger"
            value={state.value}
            aria-label={items.find((item) => item.value === state.value)?.label}
            options={items.map((item) => ({ value: item.value, label: item.label, disabled: item.disabled }))}
            onValueChange={change}
            controlSize="sm"
          />
        </div>
      </div>
      <aside className="settings-sidebar" data-searchable={state.searchable}>
        <div className="settings-nav">
          <button type="button" className="settings-back" onClick={back}>
            <SettingsIcon name="arrow-left" size="small" className="settings-back-icon" />
            <span>{backLabel}</span>
          </button>
          {state.searchable && <SettingsSearch services={props.services} />}
          {(!state.searchable || !search.query.trim()) && (
            <div
              className="settings-nav-groups"
              data-slot="tabs-v2-list"
              role="tablist"
              aria-orientation="vertical"
              onKeyDown={(event) => {
                if (!(event.target instanceof Element) || !event.target.closest('[role="tab"]')) return
                if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
                event.preventDefault()
                const enabled = items.filter((item) => !item.disabled)
                const index = enabled.findIndex((item) => item.value === state.value)
                const next =
                  enabled[
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? enabled.length - 1
                        : (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length
                  ]
                if (!next) return
                change(next.value)
                event.currentTarget
                  .querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"] button`)
                  ?.focus()
              }}
            >
              {state.groups.map((group, index) => (
                <div className="settings-nav-group" key={index}>
                  {(group.label || group.action) && (
                    <div className="settings-nav-group-header" data-component="settings-nav-group-header">
                      <span>{group.label}</span>
                      {group.action && <SharedSlot mount={group.action} />}
                    </div>
                  )}
                  {group.items.map((item) => (
                    <div
                      data-slot="tabs-v2-trigger-wrapper"
                      data-value={item.value}
                      data-selected={state.value === item.value ? "" : undefined}
                      key={item.value}
                    >
                      <Button
                        type="button"
                        role="tab"
                        variant="ghost"
                        size="sm"
                        disabled={item.disabled}
                        aria-selected={state.value === item.value}
                        id={`settings-tab-${item.value}`}
                        aria-controls={`settings-panel-${item.value}`}
                        data-slot="tabs-v2-trigger"
                        data-selected={state.value === item.value ? "" : undefined}
                        data-value={item.value}
                        tabIndex={state.value === item.value ? 0 : -1}
                        onClick={() => change(item.value)}
                        onPointerEnter={(event) => {
                          if (!item.disabled && event.pointerType !== "touch") item.onPrefetch?.()
                        }}
                        onFocus={() => !item.disabled && item.onPrefetch?.()}
                      >
                        <SettingsIcon name={item.icon} />
                        <span data-slot="tabs-v2-trigger-label">{item.label}</span>
                      </Button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
      <SharedSlot mount={props.content} className="settings-content" />
    </div>
  )
}
