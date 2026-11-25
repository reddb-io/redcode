/** @jsxImportSource react */
import { useId, useState } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Field } from "@reddb-io/design-system/base/Field"
import { Input } from "@reddb-io/design-system/base/Input"
import { RadioGroup } from "@reddb-io/design-system/base/RadioGroup"
import { Pagination } from "@reddb-io/design-system/base/Pagination"
import { paginationWindow } from "@reddb-io/design-system/base/recipes"
import type { WslOnlineDistro } from "./contract"

const pageSize = 20

export function DistroCatalog(props: {
  title: string
  searchLabel: string
  emptyLabel: string
  previousLabel: string
  nextLabel: string
  query: string
  matches: readonly WslOnlineDistro[]
  selected: string | null
  disabled: boolean
  onQueryChange: (value: string) => void
  onSelect: (value: string) => void
}) {
  const name = useId()
  const [requestedPage, setPage] = useState(1)
  const pageCount = Math.ceil(props.matches.length / pageSize)
  const page = Math.min(requestedPage, Math.max(1, pageCount))
  const visible = props.matches.slice((page - 1) * pageSize, page * pageSize)
  const selected = props.matches.find((item) => item.name === props.selected)
  return (
    <>
      <Field
        label={props.searchLabel}
        className="w-full gap-0 [&>label]:sr-only"
        help={selected && !visible.includes(selected) ? selected.label : undefined}
      >
        {(control) => (
          <Input
            {...control}
            type="search"
            placeholder={props.searchLabel}
            value={props.query}
            disabled={props.disabled}
            onValueChange={(value) => {
              setPage(1)
              props.onQueryChange(value)
            }}
          />
        )}
      </Field>
      {visible.length > 0 ? (
        <div className="max-h-56 w-full overflow-y-auto overscroll-contain">
          <RadioGroup
            name={name}
            legend={props.title}
            className="min-w-0 [&>legend]:sr-only"
            optionClass="min-w-0 break-words"
            options={visible.map((item) => ({ value: item.name, label: item.label }))}
            value={props.selected ?? ""}
            disabled={props.disabled}
            onValueChange={props.onSelect}
          />
        </div>
      ) : (
        <p role="status" className="text-caption text-ink-muted">
          {props.emptyLabel}
        </p>
      )}
      {pageCount > 1 && (
        <Pagination
          label={props.title}
          pages={paginationWindow(page, pageCount, 3)}
          pageCount={pageCount}
          status={`${page} / ${pageCount}`}
          previousLabel={props.previousLabel}
          nextLabel={props.nextLabel}
          onPageChange={setPage}
          className="flex-wrap"
        />
      )}
    </>
  )
}

export function CatalogActions(props: {
  cancelLabel: string
  installLabel: string
  busy: boolean
  installing: boolean
  selected: boolean
  onCancel: () => void
  onInstall: () => void
}) {
  return (
    <div className="flex w-full flex-wrap justify-end gap-2">
      <Button variant="secondary" size="sm" disabled={props.busy} onClick={props.onCancel}>
        {props.cancelLabel}
      </Button>
      <Button
        variant="primary"
        size="sm"
        loading={props.installing}
        disabled={props.busy || !props.selected}
        onClick={props.onInstall}
      >
        {props.installLabel}
      </Button>
    </div>
  )
}
