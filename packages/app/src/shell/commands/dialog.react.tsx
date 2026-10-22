/** @jsxImportSource react */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react"
import { getDirectory, getFilename } from "@opencode/util/path"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Input } from "@reddb-io/design-system/base/Input"
import { ScrollArea } from "@reddb-io/design-system/base/ScrollArea"
import { chooseIconName } from "@opencode/ui/file-icon-data"
import sprite from "@opencode/ui/file-icon-sprite.svg"
import { Icon } from "@/runtime/react/icon.react"
import { Keybind } from "@/runtime/react/keybind.react"
import type { SharedSource } from "@/runtime/react/source"
import type { SharedLanguage } from "@/runtime/react/language"
import { SharedSlot } from "@/runtime/react/slot.react"
import type { SharedMount } from "@/runtime/react/mount"
import { formatKeybindParts } from "./keys"
import { getRelativeTime } from "@/shell/time"
import type { CommandPaletteEntry } from "./palette"
import "./dialog.css"

type Snapshot = {
  language: SharedLanguage
  placeholder: string
  query: string
  items: CommandPaletteEntry[]
  loading: boolean
  avatars: Record<string, SharedMount>
  openSessions: Set<string>
}

export function CommandPalette(props: {
  source: SharedSource<Snapshot>
  setQuery: (query: string) => void
  highlight: (item: CommandPaletteEntry | undefined) => void
  select: (item: CommandPaletteEntry | undefined) => void
  close: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const [active, setActive] = useState<string>()
  const entry = view.items.find((entry) => entry.id === active) ?? view.items[0]
  // Pin automatic selection as well, before a slower source inserts preceding rows.
  if (active !== entry?.id) setActive(entry?.id)
  const results = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const grouped = Map.groupBy(view.items, (entry) => entry.category)
  useEffect(() => {
    props.highlight(entry)
  }, [entry, props.highlight])
  useEffect(() => {
    input.current?.focus()
  }, [])
  const move = (delta: -1 | 1) => {
    if (!view.items.length) return
    const index = view.items.findIndex((item) => item.id === entry?.id)
    setActive(view.items[(index + delta + view.items.length) % view.items.length].id)
    requestAnimationFrame(() => results.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" }))
  }
  const keydown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      move(event.key === "ArrowDown" ? 1 : -1)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      props.select(entry)
    }
  }
  return (
    <Dialog
      open
      title={view.placeholder}
      size="lg"
      className="command-palette"
      header={() => null}
      showClose={false}
      onOpenChange={(open) => {
        if (!open) props.close()
      }}
    >
      <div className="command-palette-body">
        <div className="command-palette-search relative">
          <Icon
            name="magnifying-glass"
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted"
          />
          <Input
            ref={input}
            autoFocus
            value={view.query}
            autoComplete="off"
            spellCheck={false}
            controlSize="lg"
            placeholder={view.placeholder}
            aria-label={view.placeholder}
            aria-autocomplete="list"
            aria-controls={`${id}-results`}
            aria-activedescendant={entry ? `${id}-${entry.id}` : undefined}
            onValueChange={(query) => {
              setActive(undefined)
              props.setQuery(query)
            }}
            onKeyDown={keydown}
          />
        </div>
        <ScrollArea ref={results} variant="plain" label={view.placeholder} className="command-palette-scroll">
          <div id={`${id}-results`} className="command-palette-results" role="listbox" aria-label={view.placeholder}>
            {view.items.length ? (
              [...grouped].map(([category, entries]) => (
                <div key={category} className="command-palette-group" role="group" aria-label={category}>
                  {category && <div className="command-palette-group-title">{category}</div>}
                  {entries.map((item) => (
                    <PaletteRow
                      key={item.id}
                      id={`${id}-${item.id}`}
                      item={item}
                      active={entry?.id === item.id}
                      language={view.language}
                      avatar={view.avatars[item.id]}
                      sessionOpen={
                        !!item.server && !!item.sessionID && view.openSessions.has(`${item.server}\0${item.sessionID}`)
                      }
                      onActive={() => setActive(item.id)}
                      onSelect={() => props.select(item)}
                    />
                  ))}
                </div>
              ))
            ) : (
              <div className="command-palette-state" role="status">
                {view.language.t(view.loading ? "common.loading" : "palette.empty")}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </Dialog>
  )
}

function PaletteRow(props: {
  id: string
  item: CommandPaletteEntry
  active: boolean
  language: SharedLanguage
  avatar?: SharedMount
  sessionOpen: boolean
  onActive: () => void
  onSelect: () => void
}) {
  const item = props.item
  return (
    <button
      id={props.id}
      type="button"
      className="command-palette-row group"
      role="option"
      tabIndex={-1}
      aria-selected={props.active}
      data-active={props.active ? "" : undefined}
      onMouseMove={(event) => {
        if (event.movementX !== 0 || event.movementY !== 0) props.onActive()
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onSelect}
    >
      {item.type === "file" ? (
        <div className="command-palette-row-main">
          <svg data-component="file-icon" aria-hidden="true" className="command-palette-row-icon size-4">
            <use href={`${sprite}#${chooseIconName(item.path ?? "", "file", false)}`} />
          </svg>
          <div className="command-palette-file-path">
            <span className="command-palette-file-dir">{getDirectory(item.path ?? "")}</span>
            <span className="command-palette-file-name">{getFilename(item.path ?? "")}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="command-palette-row-main">
            {item.type === "session" && (
              <div className="relative shrink-0">
                {props.sessionOpen && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-sm bg-v2-background-bg-layer-04"
                    style={{ right: "calc(100% + 4px)" }}
                  />
                )}
                {props.avatar && <SharedSlot mount={props.avatar} />}
              </div>
            )}
            <div className="command-palette-row-text">
              <span className={`command-palette-title ${item.archived ? "opacity-70" : ""}`}>{item.title}</span>
              {item.description && (
                <span className={`command-palette-description ${item.archived ? "opacity-70" : ""}`}>
                  {item.description}
                </span>
              )}
            </div>
          </div>
          {item.type === "command" && item.keybind && (
            <Keybind keys={formatKeybindParts(item.keybind, props.language.t)} />
          )}
          {item.type === "session" && !!item.updated && (
            <span className="command-palette-meta">
              {getRelativeTime(new Date(item.updated).toISOString(), props.language.t)}
            </span>
          )}
        </>
      )}
    </button>
  )
}
