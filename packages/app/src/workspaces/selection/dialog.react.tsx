/** @jsxImportSource react */
import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type PointerEvent } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Input } from "@reddb-io/design-system/base/Input"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import { DialogHeader } from "@/runtime/react/dialog-header.react"
import type { createDirectoryPickerServices } from "./dialog"

export function DirectoryPickerView(props: { services: ReturnType<typeof createDirectoryPickerServices> }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const path = useRef<HTMLDivElement>(null)
  const browser = useRef<HTMLDivElement>(null)
  const suggestions = useId()
  useLayoutEffect(() => {
    if (browser.current) return services.mountTree(browser.current)
  }, [services])
  useEffect(() => {
    const outside = (event: Event) => {
      if (event.target instanceof Node && path.current?.contains(event.target)) return
      services.hideSuggestions()
    }
    document.addEventListener("pointerdown", outside)
    return () => document.removeEventListener("pointerdown", outside)
  }, [services])
  useEffect(() => {
    const element = browser.current
    if (!element) return
    // The virtual tree scrolls inside its shadow root; stop the browser scrolling the host as well.
    const wheel = (event: WheelEvent) => {
      if (services.scrollTree(event.deltaY)) event.preventDefault()
    }
    const touch = (event: TouchEvent) => event.stopPropagation()
    element.addEventListener("wheel", wheel, { passive: false })
    element.addEventListener("touchmove", touch)
    return () => {
      element.removeEventListener("wheel", wheel)
      element.removeEventListener("touchmove", touch)
    }
  }, [services])
  return (
    <Dialog
      open={view.open}
      title={view.title}
      showClose={false}
      size="lg"
      className="directory-picker h-[min(600px,calc(100dvh-32px))] [&_[data-dialog-body]]:flex [&_[data-dialog-body]]:flex-col [&_[data-dialog-body]]:overflow-hidden"
      header={() => <DialogHeader title={view.title} language={view.language} close={services.close} />}
      onOpenChange={(open) => {
        if (!open) services.close()
      }}
    >
      <div className="directory-picker-body">
        <div className="directory-picker-path" ref={path}>
          <Input
            type="text"
            autoFocus
            className="min-w-0 w-full"
            value={view.state.input}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-label={view.title}
            aria-autocomplete="list"
            aria-expanded={view.state.suggestionsOpen && view.suggestions.length > 0}
            aria-controls={suggestions}
            aria-activedescendant={
              view.state.activeSuggestion >= 0 && view.state.suggestionsOpen
                ? `${suggestions}-${view.state.activeSuggestion}`
                : undefined
            }
            onValueChange={services.input}
            onKeyDown={(event) => services.handleInputKey(event.nativeEvent)}
          />
          <div className="directory-picker-actions">
            <Button size="sm" variant="ghost" onClick={services.home}>
              ~
            </Button>
            <Button size="sm" variant="ghost" onClick={services.root}>
              {view.language.t("dialog.directory.root")}
            </Button>
            <Button size="sm" variant="ghost" onClick={services.parent}>
              {view.language.t("dialog.directory.parent")}
            </Button>
          </div>
          {view.state.suggestionsOpen && view.suggestions.length > 0 && (
            <div id={suggestions} role="listbox" aria-label={view.title} className="directory-picker-suggestions">
              {view.suggestions.map((suggestion, index) => (
                <ListRow
                  key={suggestion.absolute}
                  id={`${suggestions}-${index}`}
                  data-directory-path={suggestion.absolute}
                  role="option"
                  aria-selected={index === view.state.activeSuggestion}
                  selected={index === view.state.activeSuggestion}
                  onPointerMove={() => services.active(index)}
                  onPointerDown={(event: PointerEvent<HTMLButtonElement>) => event.preventDefault()}
                  onClick={() => services.chooseSuggestion(suggestion)}
                  title={suggestion.label}
                />
              ))}
            </div>
          )}
        </div>
        <div className="directory-picker-browser" ref={browser}>
          {view.state.loading && (
            <div role="status" className="directory-picker-state">
              {view.language.t("common.loading")}
            </div>
          )}
          {!view.state.loading && view.state.error && (
            <div role="alert" className="directory-picker-state">
              {view.language.t("dialog.directory.readError")}
            </div>
          )}
        </div>
        <div className="directory-picker-selection">{view.result}</div>
      </div>
      <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-muted pt-3">
        <Button variant="secondary" onClick={services.close}>
          {view.language.t("common.cancel")}
        </Button>
        <Button variant="primary" disabled={!view.result} onClick={services.resolve}>
          {view.action}
        </Button>
      </div>
    </Dialog>
  )
}
