/** @jsxImportSource react */
import { Fragment, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { createSettingsSearchServices } from "./search"
import { rankSettings, type SettingsSearchResult } from "./search-results"
import { SettingsSearchEmpty } from "./search-empty.react"
import { SettingsSearchInput } from "./search-input.react"
import { SettingsIcon } from "./icon.react"
import { ProjectTile } from "./workspaces/project-tile.react"

export function SettingsSearch(props: { services: ReturnType<typeof createSettingsSearchServices> }) {
  const services = props.services
  const snapshot = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const search = services.search
  const state = useSyncExternalStore(search.source.subscribe, search.source.getSnapshot)
  const language = snapshot.language
  const [narrow, setNarrow] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const results = useRef<HTMLDivElement>(null)
  const listID = `settings-results-${useId()}`
  useLayoutEffect(() => {
    const screen = root.current?.closest<HTMLElement>(".settings-screen")
    if (!screen) return
    setNarrow(screen.clientWidth < 800)
    const observer = new ResizeObserver((entries) => setNarrow(entries[0].contentRect.width < 800))
    observer.observe(screen)
    return () => observer.disconnect()
  }, [])
  const matches = useMemo(
    () => rankSettings(state.query, snapshot.catalog, state.origin ?? snapshot.view),
    [state.query, state.origin, snapshot],
  )
  const category = (item: SettingsSearchResult) =>
    item.topLevel
      ? "settings.search.group.pages"
      : !item.entity
        ? "settings.search.group.settings"
        : item.project
          ? "settings.search.group.projects"
          : "settings.search.group.servers"
  const shown = useMemo(() => {
    const groups = new Map<ReturnType<typeof category>, SettingsSearchResult[]>()
    matches.slice(0, 60).forEach((item) => {
      const key = category(item)
      const items = groups.get(key)
      if (items) return items.push(item)
      groups.set(key, [item])
    })
    return Array.from(groups.values()).flat()
  }, [matches])
  const iconGroups = new Set(shown.filter((item) => item.topLevel || item.projectInfo).map(category))
  const expanded = !!state.query.trim() && (!narrow || state.expanded)
  const highlighted = shown.find((item) => item.id === state.highlighted) ?? shown[0]
  const optionID = (id: string) => `${listID}-${encodeURIComponent(id)}`
  const group = (item: SettingsSearchResult) =>
    item.entity && !item.project ? "" : !item.server || snapshot.multiple ? item.owner : (item.projectName ?? "")
  const select = (item: SettingsSearchResult) => {
    search.open(item.view, item.id)
    if (!narrow || item.view.type !== "root") return
    input.current?.blur()
    root.current?.closest<HTMLElement>(".settings-screen")?.focus({ preventScroll: true })
  }
  const clear = () => {
    search.clear()
    input.current?.focus()
  }
  useLayoutEffect(() => {
    if (results.current) results.current.scrollTop = search.state.scrollTop
  }, [!!state.query.trim()])
  const previousQuery = useRef(state.query)
  useLayoutEffect(() => {
    if (previousQuery.current !== state.query && results.current) results.current.scrollTop = 0
    previousQuery.current = state.query
  }, [state.query])
  return (
    <div
      ref={root}
      className="settings-search"
      data-expanded={state.expanded}
      data-empty={!state.query.trim()}
      onKeyDownCapture={(event) => {
        if (
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return
        if (
          event.target !== input.current &&
          !(event.target instanceof Element && event.target.closest(".settings-search-result"))
        )
          return
        if (event.key === "Escape" && state.query) {
          event.preventDefault()
          event.stopPropagation()
          clear()
          return
        }
        if (event.key === "Enter" && expanded && highlighted) {
          event.preventDefault()
          event.stopPropagation()
          select(highlighted)
          return
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
        if ((event.key === "Home" || event.key === "End") && event.target === input.current) return
        event.preventDefault()
        event.stopPropagation()
        search.expand()
        const index = shown.findIndex((item) => item.id === highlighted?.id)
        const next =
          shown[
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? shown.length - 1
                : Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))
          ]
        if (!next) return
        search.highlight(next.id)
        const row = results.current?.querySelector<HTMLElement>(`#${CSS.escape(optionID(next.id))}`)
        if (event.target !== input.current) row?.focus({ preventScroll: true })
        row?.scrollIntoView({ block: "nearest", inline: "nearest" })
      }}
    >
      <SettingsSearchInput
        inputRef={(element) => {
          input.current = element
          services.input.current = element ?? undefined
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-activedescendant={expanded && highlighted ? optionID(highlighted.id) : undefined}
        aria-controls={state.query.trim() ? listID : undefined}
        value={state.query}
        placeholder={language.t("settings.search.placeholder")}
        aria-label={language.t("settings.search.placeholder")}
        clearLabel={language.t("common.clear")}
        onClear={clear}
        onFocus={search.expand}
        onValueChange={search.input}
      />
      {!!state.query.trim() && (
        <div className="settings-search-matches">
          <div className="settings-search-scroll" data-empty={!shown.length}>
            <div
              ref={results}
              className="scroll-view__viewport"
              onScroll={(event) => search.scroll(event.currentTarget.scrollTop)}
            >
              <div
                id={listID}
                className="settings-search-results"
                role="listbox"
                aria-label={language.t("settings.search.results")}
              >
                {shown.map((item, index) => (
                  <Fragment key={item.id}>
                    {(index === 0 || category(shown[index - 1]) !== category(item)) && (
                      <div className="settings-search-category" role="presentation">
                        {language.t(category(item))}
                      </div>
                    )}
                    {group(item) &&
                      (index === 0 ||
                        category(shown[index - 1]) !== category(item) ||
                        group(shown[index - 1]) !== group(item)) && (
                        <div className="settings-search-group" role="presentation">
                          <bdi dir="auto">{group(item)}</bdi>
                        </div>
                      )}
                    <button
                      id={optionID(item.id)}
                      role="option"
                      aria-selected={highlighted?.id === item.id}
                      aria-label={
                        item.page === item.title && !item.owner
                          ? item.title
                          : language.t(
                              item.page === item.title
                                ? "settings.search.page"
                                : item.owner
                                  ? "settings.search.result"
                                  : "settings.search.result.unscoped",
                              { title: item.title, scope: item.owner, page: item.page },
                            )
                      }
                      type="button"
                      className="settings-search-result"
                      data-icons={iconGroups.has(category(item))}
                      data-setting-target={item.view.target}
                      data-result-id={item.id}
                      data-highlighted={highlighted?.id === item.id}
                      aria-current={state.selected === item.id ? "location" : undefined}
                      title={[item.owner, item.page].filter(Boolean).join(" › ")}
                      tabIndex={highlighted?.id === item.id ? 0 : -1}
                      onFocus={() => search.highlight(item.id)}
                      onClick={(event) => {
                        if (item.view.type === "root" && !narrow) event.currentTarget.focus({ preventScroll: true })
                        select(item)
                      }}
                    >
                      <span className="settings-search-label">
                        {item.projectInfo ? (
                          <ProjectTile project={item.projectInfo} className="settings-search-project-icon" />
                        ) : item.topLevel && item.icon ? (
                          <SettingsIcon name={item.icon} />
                        ) : null}
                        <bdi dir="auto" className="settings-search-title">
                          {item.title}
                        </bdi>
                      </span>
                      {item.page !== item.title && !(item.entity && item.project) && (
                        <span className="settings-search-detail">{item.page}</span>
                      )}
                    </button>
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
          {!matches.length && <SettingsSearchEmpty query={state.query} language={language} />}
          {matches.length > shown.length && (
            <p className="settings-search-note">{language.t("settings.search.refine")}</p>
          )}
        </div>
      )}
    </div>
  )
}
