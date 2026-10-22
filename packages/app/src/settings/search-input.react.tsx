/** @jsxImportSource react */
import { useLayoutEffect, useRef, useState, type ComponentProps } from "react"
import { Input } from "@reddb-io/design-system/base/Input"
import { Button } from "@reddb-io/design-system/base/Button"
import { SettingsIcon } from "./icon.react"
import "./search.css"

export function SettingsSearchInput(
  props: Omit<ComponentProps<typeof Input<"search">>, "type" | "ref"> & {
    inputRef?: (element: HTMLInputElement | null) => void
    clearLabel: string
    onClear: () => void
  },
) {
  const { clearLabel, onClear, inputRef, ...input } = props
  const element = useRef<HTMLInputElement>(null)
  const [overflow, setOverflow] = useState({ start: false, end: false })
  const update = () => {
    if (!element.current) return
    const offset = Math.abs(element.current.scrollLeft)
    const start = offset > 1
    const end = element.current.scrollWidth - element.current.clientWidth - offset > 1
    setOverflow((previous) => (previous.start === start && previous.end === end ? previous : { start, end }))
  }
  useLayoutEffect(() => {
    update()
    const observer = new ResizeObserver(update)
    if (element.current) observer.observe(element.current)
    return () => observer.disconnect()
  }, [input.value])
  return (
    <div data-component="settings-search-input">
      <SettingsIcon name="magnifying-glass" size="small" />
      <Input
        {...input}
        ref={(node) => {
          element.current = node
          inputRef?.(node)
        }}
        type="search"
        controlSize="sm"
        data-overflow-start={overflow.start}
        data-overflow-end={overflow.end}
        onScroll={(event) => {
          update()
          input.onScroll?.(event)
        }}
        spellCheck={false}
        autoComplete="off"
      />
      <Button
        variant="ghost"
        size="sm"
        aria-label={clearLabel}
        onClick={onClear}
        style={{ visibility: input.value ? undefined : "hidden" }}
      >
        <SettingsIcon name="circle-xmark" size="small" />
      </Button>
    </div>
  )
}
