/** @jsxImportSource react */
import { useEffect, useRef } from "react"
import { SettingsSearchInput } from "./search-input.react"
import type { SettingsLanguage } from "./shared.react"

export function SettingsSearchField(props: {
  value: string
  placeholder: string
  active: boolean
  onInput: (value: string) => void
  language: SettingsLanguage
}) {
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const current = useRef(props)
  current.current = props
  useEffect(() => {
    const screen = root.current?.closest<HTMLElement>(".settings-screen")
    if (!screen) return
    const handle = (event: KeyboardEvent) => {
      const props = current.current
      if (
        !props.active ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key.length !== 1 ||
        !event.key.trim() ||
        (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]"))
      )
        return
      event.preventDefault()
      event.stopPropagation()
      const value = `${props.value}${event.key}`
      props.onInput(value)
      input.current?.focus({ preventScroll: true })
      queueMicrotask(() => input.current?.setSelectionRange(value.length, value.length))
    }
    screen.addEventListener("keydown", handle)
    return () => screen.removeEventListener("keydown", handle)
  }, [])
  const clear = () => {
    props.onInput("")
    input.current?.focus({ preventScroll: true })
  }
  return (
    <div ref={root} className="settings-tab-search settings-filter-search" data-component="settings-filter-search">
      <SettingsSearchInput
        inputRef={(element) => {
          input.current = element
        }}
        value={props.value}
        onValueChange={props.onInput}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        clearLabel={props.language.t("common.clear")}
        onClear={clear}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return
          event.preventDefault()
          event.stopPropagation()
          if (props.value) {
            clear()
            return
          }
          event.currentTarget.blur()
          event.currentTarget.closest<HTMLElement>(".settings-screen")?.focus({ preventScroll: true })
        }}
      />
    </div>
  )
}
