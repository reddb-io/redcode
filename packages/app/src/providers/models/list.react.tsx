/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import { Icon } from "@/runtime/react/icon.react"
import { ProviderModelIcon } from "@/settings/providers/provider-icon.react"
import { modelSections } from "./sections"
import { handleDocumentSearchKeydown } from "@/shell/commands/search-keydown"
import { modelTooltipDescription } from "./tooltip-text"
import type { createModelListServices } from "./select-dialog"

type Services = ReturnType<typeof createModelListServices>
type View = ReturnType<Services["snapshot"]["getSnapshot"]>
type Option = View["options"][number]

export function ModelListView(props: {
  services: Services
  menu?: boolean
  actions?: { key: string; label: string; icon: string; disabled?: boolean; run: () => void }[]
  select?: Services["select"]
  escape?: () => void
}) {
  const view = useSyncExternalStore(props.services.snapshot.subscribe, props.services.snapshot.getSnapshot)
  const [search, setSearch] = useState("")
  const [active, setActive] = useState(
    view.mobile || props.menu ? (view.current ?? (props.menu ? (view.options[0]?.key ?? "") : "")) : "",
  )
  const [offers, setOffers] = useState<Record<string, boolean>>({})
  const scroll = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const previousSearch = useRef(search)
  const keyboardNavigation = useRef(false)
  const sections = useMemo(() => modelSections(view.options, {
    search,
    favorites: view.favorites,
    recent: view.recent,
    provider: view.provider,
  }), [view.options, view.favorites, view.recent, view.provider, search])
  const options = useMemo(() => sections.flatMap((section) => section.items), [sections])
  const positions = useMemo(() => new Map(options.map((option, index) => [option.key, index + 1])), [options])
  const rows = useMemo(() => sections.flatMap((section) => [
    ...(section.kind === "results" ? [] : [{ type: "heading" as const, section }]),
    ...section.items.map((option) => ({ type: "model" as const, option, section })),
  ]), [sections])
  const virtual = useVirtualizer({
    count: props.menu ? rows.length : 0,
    getScrollElement: () => scroll.current,
    estimateSize: (index) => rows[index]?.type === "heading" ? 32 : 56,
    getItemKey: (index) => {
      const row = rows[index]
      return row?.type === "model" ? row.option.key : row?.section.key ?? index
    },
    overscan: 4,
  })
  useEffect(() => {
    if (!view.mobile || !view.open) return
    setSearch("")
    setActive(view.current ?? "")
  }, [view.open])
  useLayoutEffect(() => {
    if (previousSearch.current === search) return
    previousSearch.current = search
    setActive(options[0]?.key ?? "")
  }, [search, options])
  const filter = (value: string) => {
    setSearch(value)
  }
  useLayoutEffect(() => {
    if (!props.menu || !view.current) return
    const index = rows.findIndex((row) => row.type === "model" && row.option.key === view.current)
    if (index >= 0) virtual.scrollToIndex(index, { align: "auto" })
  }, [props.menu, view.current, rows, virtual])
  const select = props.select ?? props.services.select
  useEffect(() => {
    if (!props.menu) return
    const keydown = (event: KeyboardEvent) =>
      handleDocumentSearchKeydown(input.current ?? undefined, event, search, filter)
    document.addEventListener("keydown", keydown, true)
    return () => document.removeEventListener("keydown", keydown, true)
  }, [props.menu, search, view])
  const move = (delta: 1 | -1) => {
    keyboardNavigation.current = true
    const keys = [...options.map((option) => option.key), ...(props.actions ?? []).map((action) => action.key)]
    if (!keys.length) return
    const index = keys.indexOf(active)
    const start = index === -1 ? (delta > 0 ? -1 : 0) : index
    const next = keys[(start + delta + keys.length) % keys.length]
    setActive(next)
    if (props.menu) {
      const index = rows.findIndex((row) => row.type === "model" && row.option.key === next)
      if (index >= 0) virtual.scrollToIndex(index, { align: "auto" })
      return
    }
    scroll.current
      ?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(next)}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }
  const row = (option: Option) => {
    const control = (trigger: Record<string, unknown> = {}) => (
      <ListRow
        {...trigger}
        data-component={props.menu ? undefined : "settings-row"}
        data-model-tooltip=""
        data-option-key={option.key}
        role={props.menu ? "menuitemradio" : undefined}
        aria-checked={props.menu ? view.current === option.key : undefined}
        aria-posinset={props.menu ? positions.get(option.key) : undefined}
        aria-setsize={props.menu ? options.length : undefined}
        aria-pressed={!props.menu ? view.current === option.key : undefined}
        data-selected-model={props.menu && view.current === option.key ? true : undefined}
        className="w-full text-start"
        style={{
          paddingInline: view.mobile || props.menu ? 12 : 16,
          paddingBlock: view.mobile ? 16 : props.menu ? 4 : 12,
        }}
        selected={active === option.key}
        onClick={() => select(option.item)}
        trailing={
          <>
            <span className="flex size-4 items-center justify-center">
              {view.current === option.key && <Icon name="check" size="small" />}
            </span>
            <span className="w-7 shrink-0" aria-hidden="true" />
          </>
        }
      >
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate">{option.title}</span>
            {option.footer === "Free" && <Badge>{view.language.t("model.tag.free")}</Badge>}
            {option.item.latest && <Badge>{view.language.t("model.tag.latest")}</Badge>}
          </span>
          <span className="truncate text-caption text-ink-muted">{option.description}</span>
        </span>
      </ListRow>
    )
    return (
      <>
        <div
          data-slot="model-row"
          className="group relative [&>[data-tooltip-root]]:flex [&>[data-tooltip-root]]:w-full"
          onMouseEnter={() => {
            if (keyboardNavigation.current) return
            setActive(option.key)
            if (props.menu) input.current?.focus()
          }}
          onMouseMove={() => {
            if (!keyboardNavigation.current) return
            keyboardNavigation.current = false
            setActive(option.key)
          }}
          onMouseLeave={() => {
            if (!keyboardNavigation.current) setActive("")
          }}
        >
          {view.mobile ? (
            control()
          ) : (
            <Tooltip
              content={modelTooltipDescription(option.item, view.language, option.footer === "Free")}
              child={({ props: trigger }) => control(trigger)}
            />
          )}
          <Button
            tabIndex={-1}
            variant="ghost"
            size="sm"
            data-action="model-favorite"
            aria-pressed={option.favorite}
            aria-label={view.language.t(option.favorite ? "dialog.model.favorite.remove" : "dialog.model.favorite.add")}
            title={view.language.t(option.favorite ? "dialog.model.favorite.remove" : "dialog.model.favorite.add")}
            className={`absolute end-0 top-1/2 -translate-y-1/2 ${!option.favorite && !view.mobile ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : ""}`}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              props.services.toggleFavorite(option)
            }}
          >
            <Icon name={option.favorite ? "star-filled" : "star"} size="small" />
          </Button>
        </div>
        {option.offers.length > 0 && (
          <>
            <ListRow
              className="ps-8"
              aria-expanded={!!offers[option.key]}
              onClick={() => setOffers({ ...offers, [option.key]: !offers[option.key] })}
              leading={<Icon name={offers[option.key] ? "chevron-down" : "chevron-right"} size="small" />}
              title={view.language.plural("model.offers.count", option.offers.length)}
            />
            {offers[option.key] &&
              option.offers.map((entry, index) => (
                <ListRow
                  key={index}
                  className="ps-12"
                  title={entry.route}
                  description={entry.details}
                  disabled={!entry.model}
                  onClick={() => {
                    if (entry.model) select(entry.model)
                  }}
                  trailing={
                    entry.model &&
                    view.current === `${entry.model.provider.id}:${entry.model.id}` && (
                      <Icon name="check" size="small" />
                    )
                  }
                />
              ))}
          </>
        )}
      </>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" role={props.menu ? "menu" : undefined}>
      <div data-slot="model-selector-search" className={`relative shrink-0 pt-px pb-3 ${view.mobile ? "" : "px-4"}`}>
        <Input
          ref={input}
          type="search"
          autoFocus={!view.mobile}
          className="w-full self-stretch pe-9 [&::-webkit-search-cancel-button]:hidden"
          placeholder={view.language.t("dialog.model.search.placeholder")}
          value={search}
          spellCheck={false}
          autoCorrect="off"
          autoComplete="off"
          autoCapitalize="off"
          aria-label={view.language.t("dialog.model.search.placeholder")}
          onValueChange={filter}
          onKeyDown={(event) => {
            if (props.menu && event.key !== "Tab") event.stopPropagation()
            if (event.key === "Escape" && props.escape) {
              event.preventDefault()
              props.escape()
              return
            }
            if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
              event.preventDefault()
              const option = options.find((option) => option.key === active)
              if (option) props.services.toggleFavorite(option)
              return
            }
            if (event.altKey || event.metaKey) return
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              move(event.key === "ArrowDown" ? 1 : -1)
              return
            }
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            event.preventDefault()
            const option = options.find((option) => option.key === active)
            if (option) select(option.item)
            if (!option) props.actions?.find((action) => action.key === active && !action.disabled)?.run()
          }}
        />
        {!!search && (
          <Button
            variant="ghost"
            size="sm"
            className={`absolute top-px ${view.mobile ? "end-0" : "end-4"}`}
            aria-label={view.language.t("common.clear")}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              filter("")
              input.current?.focus()
            }}
          >
            <Icon name="circle-xmark" />
          </Button>
        )}
      </div>
      <div className={`relative min-h-0 ${view.mobile ? "" : "flex-1"}`}>
        <div
          ref={scroll}
          data-slot={props.menu ? "model-selector-scroll" : undefined}
          className={
            props.menu
              ? "max-h-[320px] min-h-0 overflow-y-auto px-1 pt-1 pb-2"
              : `settings-panel settings-models pt-1 pb-4 ${view.mobile ? "max-h-[min(360px,40dvh)]" : "h-full px-4"}`
          }
        >
          {!options.length ? (
            <div role="status" className="settings-models-status">
              {view.language.t("dialog.model.empty")}
            </div>
          ) : props.menu ? (
            <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
              {virtual.getVirtualItems().map((virtualRow) => {
                const entry = rows[virtualRow.index]
                if (!entry) return null
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtual.measureElement}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {entry.type === "heading" ? (
                      <h3 className="m-0 flex min-h-8 items-center gap-2 px-3 text-eyebrow uppercase text-ink-muted">
                        {entry.section.kind === "route" ? (
                          <ProviderModelIcon provider={entry.section.items[0].item.provider} className="shrink-0" />
                        ) : (
                          <Icon name={entry.section.kind === "favorites" ? "star" : "reset"} size="small" />
                        )}
                        <span className="min-w-0 truncate">
                          {entry.section.kind === "favorites" ? view.language.t("dialog.model.section.favorites") :
                            entry.section.kind === "recent" ? view.language.t("dialog.model.section.recent") : entry.section.category}
                        </span>
                      </h3>
                    ) : row(entry.option)}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {sections.map((section) => (
                <section key={section.key} className="flex flex-col gap-2" data-section={section.key}>
                  {section.kind !== "results" && (
                    <h3
                      className={`m-0 flex items-center gap-2 text-eyebrow uppercase text-ink-muted ${props.menu ? "px-3" : ""}`}
                    >
                      {section.kind === "route" ? (
                        <ProviderModelIcon provider={section.items[0].item.provider} className="shrink-0" />
                      ) : (
                        <Icon name={section.kind === "favorites" ? "star" : "reset"} size="small" />
                      )}
                      <span className="min-w-0 truncate">
                        {section.kind === "favorites"
                          ? view.language.t("dialog.model.section.favorites")
                          : section.kind === "recent"
                            ? view.language.t("dialog.model.section.recent")
                            : section.category}
                      </span>
                    </h3>
                  )}
                  <div
                    data-component={props.menu ? undefined : "settings-list"}
                    data-variant={props.menu ? undefined : "catalog"}
                  >
                    {section.items.map((option) => (
                      <div key={option.key}>{row(option)}</div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
      {props.actions && (
        <div className="flex shrink-0 flex-col border-t border-muted pt-1">
          {props.actions.map((action) => (
            <ListRow
              key={action.key}
              role="menuitem"
              data-option-key={action.key}
              selected={active === action.key}
              disabled={action.disabled}
              title={action.label}
              leading={<Icon name={action.icon} size="small" />}
              onMouseEnter={() => {
                setActive(action.key)
                input.current?.focus()
              }}
              onClick={action.run}
            />
          ))}
        </div>
      )}
    </div>
  )
}
