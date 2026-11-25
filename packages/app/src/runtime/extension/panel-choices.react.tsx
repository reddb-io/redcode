/** @jsxImportSource react */
import { useMemo } from "react"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import { Card } from "@reddb-io/design-system/base/Card"
import { Icon } from "@/runtime/react/icon.react"
import { Keybind } from "@/runtime/react/keybind.react"
import type { SharedLanguage } from "@/runtime/react/language"
import { SearchableRows } from "@/runtime/react/searchable-rows.react"

type PanelChoice = {
  value: string
  label: string
  description?: string
  icon?: string
  keys?: string[]
  selected?: boolean
  drawer?: boolean
  run: () => void
}

export function PanelChoices(props: {
  items: PanelChoice[]
  title: string
  language: SharedLanguage
  mobile?: boolean
}) {
  const byValue = useMemo(() => new Map(props.items.map((item) => [item.value, item])), [props.items])
  const rows = (
    <SearchableRows
      options={props.items}
      role={props.mobile ? "group" : "list"}
      title={props.title}
      searchLabel={props.language.t("ui.searchSelect.search")}
      emptyLabel={props.language.t("ui.searchSelect.empty")}
      previousLabel={props.language.t("ui.common.back")}
      nextLabel={props.language.t("ui.common.next")}
      listClass={
        props.mobile ? "grid min-w-0 bg-elevation-raised-surface" : "grid min-w-0 rounded-lg border border-muted"
      }
      onSelect={(value) => byValue.get(value)?.run()}
    >
      {(option, onKeyDown) => {
        const item = byValue.get(option.value)!
        const row = (
          <ListRow
            title={item.label}
            description={item.description}
            leading={item.icon && <Icon name={item.icon} />}
            trailing={
              item.keys?.length ? (
                <Keybind keys={item.keys} />
              ) : item.drawer ? (
                <Icon name="chevron-right" className="rtl:rotate-180" />
              ) : (
                item.selected && <Icon name="check" />
              )
            }
            size={props.mobile ? "md" : "sm"}
            selected={item.selected}
            aria-pressed={item.selected}
            className={props.mobile ? "min-h-11 focus-visible:-outline-offset-2" : "focus-visible:-outline-offset-2"}
            data-value={item.value}
            data-action={props.mobile ? undefined : `workbench-launch-${item.value}`}
            onKeyDown={onKeyDown}
            onClick={item.run}
          />
        )
        return props.mobile ? row : <li className="last:[&>button]:border-b-0">{row}</li>
      }}
    </SearchableRows>
  )
  return props.mobile ? (
    <Card data-slot="session-mobile-view-options" padding="sm" raised>
      {rows}
    </Card>
  ) : (
    rows
  )
}
