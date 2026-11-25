/** @jsxImportSource react */
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Input } from "@reddb-io/design-system/base/Input"
import { Pagination } from "@reddb-io/design-system/base/Pagination"
import { Popover } from "@reddb-io/design-system/base/Popover"
import { paginationWindow, searchSelectOptions } from "@reddb-io/design-system/base/recipes"
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
const pageSize = 20

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
  const [query, setQuery] = useState("")
  const [requestedPage, setPage] = useState(1)
  const root = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState<string>()
  const colors = useMemo(() => new Map(props.options.map((item) => [item.id, item.color])), [props.options])
  const options = useMemo(
    () => props.options.map((item) => ({ value: item.id, label: item.label, keywords: [item.id] })),
    [props.options],
  )
  const matches = useMemo(() => searchSelectOptions(options, query), [options, query])
  const pages = Math.ceil(matches.length / pageSize)
  const page = Math.min(requestedPage, Math.max(1, pages))
  const offset = (page - 1) * pageSize

  useLayoutEffect(() => {
    if (!focus) return
    root.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(focus)}"]`)?.focus()
    setFocus(undefined)
  }, [focus])

  function navigate(event: KeyboardEvent, index?: number) {
    if (!matches.length) return
    const last = matches.length - 1
    function destination() {
      switch (event.key) {
        case "ArrowDown":
          return index === undefined ? offset : (index + 1) % matches.length
        case "ArrowUp":
          return index === undefined ? Math.min(last, offset + pageSize - 1) : (index + last) % matches.length
        case "Home":
          return index === undefined ? undefined : 0
        case "End":
          return index === undefined ? undefined : last
      }
    }
    const target = destination()
    if (target === undefined) return
    event.preventDefault()
    setPage(Math.floor(target / pageSize) + 1)
    setFocus(matches[target].value)
  }

  return (
    <div ref={root} className="grid min-w-0 gap-2">
      <Input
        type="search"
        aria-label={props.searchLabel}
        placeholder={props.searchLabel}
        value={query}
        onValueChange={(value) => {
          setQuery(value)
          setPage(1)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === "Enter" && matches.length === 1) {
            event.preventDefault()
            props.onSelect(matches[0].value)
            return
          }
          navigate(event)
        }}
      />
      <div
        role={props.menu ? "menu" : "group"}
        aria-label={props.title}
        className="grid min-w-0 max-h-[min(45dvh,24rem)] overflow-y-auto overscroll-contain"
      >
        {matches.slice(offset, offset + pageSize).map((item, index) => (
          <ListRow
            key={item.value}
            data-value={item.value}
            role={props.menu ? "menuitemradio" : undefined}
            aria-checked={props.menu ? props.current === item.value : undefined}
            aria-pressed={props.menu ? undefined : props.current === item.value}
            selected={props.current === item.value}
            leading={colors.get(item.value) && <ColorMark color={colors.get(item.value)} />}
            trailing={props.current === item.value && <Icon name="check" size="small" />}
            onClick={() => props.onSelect(item.value)}
            onKeyDown={(event: KeyboardEvent) => navigate(event, offset + index)}
          >
            <span className={`block truncate ${props.capitalize === false ? "" : "capitalize"}`}>{item.label}</span>
          </ListRow>
        ))}
      </div>
      {!matches.length && (
        <p role="status" className="text-caption text-ink-muted">
          {props.emptyLabel}
        </p>
      )}
      {pages > 1 && (
        <Pagination
          label={props.title}
          pageCount={pages}
          pages={paginationWindow(page, pages, 3)}
          onPageChange={setPage}
          previousLabel={props.previousLabel}
          nextLabel={props.nextLabel}
          status={`${page} / ${pages}`}
          className="flex-wrap"
        />
      )}
    </div>
  )
}

function ColorMark(props: { color?: string }) {
  return props.color ? (
    <span aria-hidden="true" className="block size-2 shrink-0 rounded-full" style={{ background: props.color }} />
  ) : null
}
