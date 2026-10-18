import { Combobox } from "@kobalte/core/combobox"
import { createEffect, createMemo, createUniqueId, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  searchSelect,
  searchSelectOptions,
  type SearchSelectOption,
} from "@reddb-io/design-system/contracts/search-select"
import { input } from "@reddb-io/design-system/contracts/input"
import { popover } from "@reddb-io/design-system/contracts/popover"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "../../context/i18n"

export type { SearchSelectOption } from "@reddb-io/design-system/contracts/search-select"

export interface SearchSelectProps {
  label: string
  options: readonly SearchSelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  class?: string
}

/** A controlled single selection. Filtering never changes the value or requests remote data. */
export function SearchSelect(props: SearchSelectProps) {
  const i18n = useI18n()
  const styles = searchSelect()
  const summaryID = createUniqueId()
  let trigger: HTMLButtonElement | undefined
  const [state, setState] = createStore({ open: false, query: "" })
  const selected = createMemo(() => props.options.find((option) => option.value === props.value))
  // Kobalte resets its input when the selected object changes. Metadata refreshes
  // keep the same selection key; render fresh labels separately from that identity.
  const selection = createMemo(selected, undefined, { equals: (left, right) => left?.value === right?.value })
  const options = createMemo(() => [...searchSelectOptions(props.options, state.query)])
  const open = (value: boolean) => setState({ open: value, query: "" })
  createEffect(() => {
    if (props.disabled && state.open) open(false)
  })

  return (
    <div class={styles.root({ class: props.class })}>
      <Combobox<SearchSelectOption>
        open={state.open && !props.disabled}
        onOpenChange={open}
        options={[...props.options]}
        value={selection()}
        optionValue="value"
        optionTextValue="label"
        optionLabel={() => ""}
        optionDisabled="disabled"
        defaultFilter={(option, query) => searchSelectOptions([option], query).length > 0}
        onInputChange={(query) => setState("query", query)}
        onChange={(option) => {
          if (!option || option.disabled) return
          if (option.value !== props.value) props.onChange(option.value)
          open(false)
        }}
        disabled={props.disabled}
        allowsEmptyCollection
        placement="bottom-start"
        gutter={4}
        itemComponent={(item) => (
          <Combobox.Item
            item={item.item}
            class={styles.item({
              class: "min-h-[max(var(--reddb-spatial-control-height-md),var(--reddb-spatial-target-min))]",
            })}
          >
            <span class={styles.option()}>
              <Combobox.ItemLabel>{item.item.rawValue.label}</Combobox.ItemLabel>
              <Show when={item.item.rawValue.description}>
                <Combobox.ItemDescription class={styles.description()}>
                  {item.item.rawValue.description}
                </Combobox.ItemDescription>
              </Show>
            </span>
            <Combobox.ItemIndicator>
              <Icon name="check" size="small" />
            </Combobox.ItemIndicator>
          </Combobox.Item>
        )}
      >
        <Combobox.Control>
          <Combobox.Trigger
            ref={trigger}
            type="button"
            disabled={props.disabled}
            aria-label={props.label}
            aria-describedby={summaryID}
            class={input({
              size: "sm",
              class: styles.trigger({
                class: "flex min-h-[var(--reddb-spatial-target-min)] items-center gap-[var(--reddb-spatial-gap-sm)]",
              }),
            })}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
              event.preventDefault()
              open(true)
            }}
          >
            <span id={summaryID} class={styles.summary({ class: !selected() ? styles.placeholder() : undefined })}>
              {selected()?.label ?? (props.value || props.placeholder || i18n.t("ui.searchSelect.placeholder"))}
            </span>
            <Icon name="chevron-down" size="small" />
          </Combobox.Trigger>
        </Combobox.Control>
        <Combobox.Portal>
          <Combobox.Content
            class={popover({
              class: styles.content({
                class:
                  "flex flex-col overflow-hidden w-[max(20rem,var(--kb-popper-anchor-width))] max-h-[min(70dvh,var(--kb-popper-content-available-height))]",
              }),
            })}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              trigger?.focus()
            }}
          >
            <div class={styles.search({ class: "shrink-0" })}>
              <Combobox.Input
                ref={(element) => {
                  // The portalled input must be attached before the popup transfers focus to it.
                  queueMicrotask(() => {
                    if (!state.open || !element.isConnected) return
                    element.focus()
                  })
                }}
                aria-label={i18n.t("ui.searchSelect.search")}
                placeholder={i18n.t("ui.searchSelect.search")}
                class={input({ size: "sm" })}
              />
            </div>
            <Combobox.Listbox
              aria-label={props.label}
              // Virtual focus stays in the input until selection; blur would reset the filter before pointer-up.
              onMouseDown={(event: MouseEvent) => event.preventDefault()}
              class={styles.list({ class: "m-0 min-h-0 flex-1 overflow-y-auto p-0 list-none" })}
            />
            <Show when={!options().length}>
              <p role="status" class={styles.empty()}>
                {i18n.t("ui.searchSelect.empty")}
              </p>
            </Show>
          </Combobox.Content>
        </Combobox.Portal>
      </Combobox>
    </div>
  )
}
