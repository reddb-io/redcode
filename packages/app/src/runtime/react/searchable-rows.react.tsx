/** @jsxImportSource react */
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { Input } from "@reddb-io/design-system/base/Input"
import { Pagination } from "@reddb-io/design-system/base/Pagination"
import { paginationWindow, searchSelectOptions, type SearchSelectOption } from "@reddb-io/design-system/base/recipes"

const pageSize = 20

export function SearchableRows(props: {
  title: string
  options: readonly SearchSelectOption[]
  searchLabel: string
  emptyLabel: string
  previousLabel: string
  nextLabel: string
  role: "group" | "menu" | "list"
  listClass?: string
  onSelect: (value: string) => void
  children: (item: SearchSelectOption, onKeyDown: (event: KeyboardEvent) => void) => ReactNode
}) {
  const [query, setQuery] = useState("")
  const [requestedPage, setPage] = useState(1)
  const root = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState<string>()
  const matches = useMemo(() => searchSelectOptions(props.options, query), [props.options, query])
  const pages = Math.ceil(matches.length / pageSize)
  const page = Math.min(requestedPage, Math.max(1, pages))
  const Container = props.role === "list" ? "ul" : "div"
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
      <Container
        role={props.role}
        aria-label={props.title}
        className={props.listClass ?? "grid min-w-0 max-h-[min(45dvh,24rem)] overflow-y-auto overscroll-contain"}
      >
        {matches.slice(offset, offset + pageSize).map((item, index) => (
          <Fragment key={item.value}>{props.children(item, (event) => navigate(event, offset + index))}</Fragment>
        ))}
      </Container>
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
