/** @jsxImportSource react */
import { useMemo, useState } from "react"
import { Popover } from "@reddb-io/design-system/base/Popover"
import { SearchableRows } from "@/runtime/react/searchable-rows.react"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import { Icon } from "@/runtime/react/icon.react"
import type { ComposerOption } from "../types"

type ChoiceProps = {
  title: string
  options: ComposerOption[]
  current: string
  capitalize?: boolean
  searchLabel: string
  emptyLabel: string
  previousLabel: string
  nextLabel: string
  onSelect: (value: string) => void
}

export function ComposerChoicePopover(
  props: ChoiceProps & {
    icon?: string
    triggerClass?: string
    onOpenChange?: (open: boolean) => void
  },
) {
  const [open, setOpen] = useState(false)
  const current = props.options.find((item) => item.id === props.current)
  const changeOpen = (next: boolean) => {
    setOpen(next)
    props.onOpenChange?.(next)
  }
  return (
    <Popover
      open={open}
      onOpenChange={changeOpen}
      triggerLabel={props.title}
      contentLabel={props.title}
      variant="ghost"
      size="sm"
      side="top"
      align="start"
      sideOffset={6}
      triggerClass={`max-w-[220px] justify-start ${props.triggerClass ?? ""}`}
      className="w-72 max-w-[calc(100vw-24px)] p-2"
      trigger={
        <>
          {props.icon && <Icon name={props.icon} size="small" />}
          <ColorMark color={current?.color} />
          <span className={`min-w-0 truncate ${props.capitalize === false ? "" : "capitalize"}`}>
            {current?.label ?? props.current}
          </span>
          <Icon name="chevron-down" size="small" />
        </>
      }
    >
      {open && (
        <ComposerChoiceList
          {...props}
          menu
          onSelect={(value) => {
            changeOpen(false)
            props.onSelect(value)
          }}
        />
      )}
    </Popover>
  )
}

export function ComposerChoiceList(props: ChoiceProps & { menu?: boolean }) {
  const colors = useMemo(() => new Map(props.options.map((item) => [item.id, item.color])), [props.options])
  const options = useMemo(
    () => props.options.map((item) => ({ value: item.id, label: item.label, keywords: [item.id] })),
    [props.options],
  )
  return (
    <SearchableRows {...props} options={options} role={props.menu ? "menu" : "group"}>
      {(item, onKeyDown) => (
        <ListRow
          data-value={item.value}
          role={props.menu ? "menuitemradio" : undefined}
          aria-checked={props.menu ? props.current === item.value : undefined}
          aria-pressed={props.menu ? undefined : props.current === item.value}
          selected={props.current === item.value}
          leading={colors.get(item.value) && <ColorMark color={colors.get(item.value)} />}
          trailing={props.current === item.value && <Icon name="check" size="small" />}
          onClick={() => props.onSelect(item.value)}
          onKeyDown={onKeyDown}
        >
          <span className={`block truncate ${props.capitalize === false ? "" : "capitalize"}`}>{item.label}</span>
        </ListRow>
      )}
    </SearchableRows>
  )
}

function ColorMark(props: { color?: string }) {
  return props.color ? (
    <span aria-hidden="true" className="block size-2 shrink-0 rounded-full" style={{ background: props.color }} />
  ) : null
}
