/** @jsxImportSource react */
import { useId, useMemo, useState } from "react"
import { CreatorInput } from "./input.react"
import { Pagination } from "@reddb-io/design-system/base/Pagination"
import { RadioGroup } from "@reddb-io/design-system/base/RadioGroup"
import { paginationWindow, searchSelectOptions, type SearchSelectOption } from "@reddb-io/design-system/base/recipes"

const pageSize = 20

export function SourcePicker(props: {
  label: string
  searchLabel: string
  emptyLabel: string
  previousLabel: string
  nextLabel: string
  options: readonly SearchSelectOption[]
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const name = useId()
  const [query, setQuery] = useState("")
  const [requestedPage, setPage] = useState(1)
  const matches = useMemo(() => searchSelectOptions(props.options, query), [props.options, query])
  const pages = Math.ceil(matches.length / pageSize)
  const page = Math.min(requestedPage, Math.max(1, pages))
  const visible = matches.slice((page - 1) * pageSize, page * pageSize)
  const hiddenSelection =
    props.value && !visible.some((item) => item.value === props.value)
      ? props.options.find((item) => item.value === props.value)?.label
      : undefined

  return (
    <div className="grid min-w-0 gap-2">
      <CreatorInput
        label={props.label}
        help={hiddenSelection}
        type="search"
        disabled={props.disabled}
        placeholder={props.searchLabel}
        value={query}
        onChange={(value) => {
          setQuery(value)
          setPage(1)
        }}
      />
      {visible.length > 0 && (
        <div className="max-h-48 overflow-y-auto overscroll-contain">
          <RadioGroup
            name={name}
            legend={props.label}
            className="min-w-0 [&>legend]:sr-only"
            optionClass="min-w-0 break-words"
            options={visible}
            value={props.value}
            disabled={props.disabled}
            onValueChange={props.onChange}
          />
        </div>
      )}
      {props.options.length > 0 && query && !matches.length && (
        <p role="status" className="text-caption text-ink-muted">
          {props.emptyLabel}
        </p>
      )}
      {pages > 1 && (
        <Pagination
          label={props.label}
          pages={paginationWindow(page, pages, 3)}
          pageCount={pages}
          previousLabel={props.previousLabel}
          nextLabel={props.nextLabel}
          onPageChange={setPage}
          status={`${page} / ${pages}`}
          className="flex-wrap"
        />
      )}
    </div>
  )
}
