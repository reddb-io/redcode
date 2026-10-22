/** @jsxImportSource react */
import { useLayoutEffect, useRef, useSyncExternalStore } from "react"
import type { SharedSource } from "@/runtime/react/source"
import type { SharedMount } from "@/runtime/react/mount"
import { SharedSlot } from "@/runtime/react/slot.react"
import type { SettingsView } from "./route"
import type { createSettingsController } from "./controller"
import { revealSettingsSearch } from "./search-reveal"

export function SettingsScreenView(props: {
  snapshot: SharedSource<{
    view: SettingsView
    search: ReturnType<typeof createSettingsController>["search"]["state"]
    dialogActive: boolean
  }>
  content: SharedMount
  back: () => void
  searchBack: () => boolean
  clear: () => void
}) {
  const state = useSyncExternalStore(props.snapshot.subscribe, props.snapshot.getSnapshot)
  const root = useRef<HTMLDivElement>(null)
  const previousType = useRef(state.view.type)
  const activation = useRef(0)
  useLayoutEffect(() => root.current?.focus({ preventScroll: true }), [])
  useLayoutEffect(() => {
    if (previousType.current === state.view.type) return
    previousType.current = state.view.type
    queueMicrotask(() => {
      const target =
        state.search.query.trim() && state.search.expanded
          ? root.current?.querySelector<HTMLInputElement>(".settings-search input")
          : root.current
      target?.focus({ preventScroll: true })
    })
  }, [state.view.type])
  const route = JSON.stringify(state.view)
  useLayoutEffect(() => {
    if (
      !root.current ||
      !state.search.selected ||
      !state.view.searchActivation ||
      state.view.searchActivation !== state.search.activation ||
      state.view.searchActivation === activation.current
    )
      return
    activation.current = state.view.searchActivation
    return revealSettingsSearch(root.current, state.view)
  }, [route, state.search.selected, state.search.activation])
  return (
    <div
      ref={root}
      data-testid="settings-screen"
      className="settings-screen"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || state.dialogActive) return
        if (event.target instanceof Element && event.target.closest("dialog[open]")) return
        event.preventDefault()
        if (state.view.type !== "root" && props.searchBack()) return
        if (state.search.query.trim()) {
          props.clear()
          return
        }
        props.back()
      }}
    >
      <SharedSlot mount={props.content} />
    </div>
  )
}
