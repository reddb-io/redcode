/** @jsxImportSource react */
import { useLayoutEffect, useRef, useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Textarea } from "@reddb-io/design-system/base/Textarea"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import { listRow } from "@reddb-io/design-system/app/recipes"
import { Icon } from "@/runtime/react/icon.react"
import type { createSessionQuestionServices } from "./session-question-dock"

type Services = ReturnType<typeof createSessionQuestionServices>
type View = ReturnType<Services["snapshot"]["getSnapshot"]>

export function SessionQuestionDockView(props: { services: Services }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = view.language
  const root = useRef<HTMLDivElement>(null)
  const options = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    let frame: number | undefined
    const measure = () => {
      const scroller = document.querySelector(".scroll-view__viewport")
      const head = scroller instanceof HTMLElement ? scroller.firstElementChild : undefined
      const top =
        head instanceof HTMLElement && head.classList.contains("sticky") ? head.getBoundingClientRect().bottom : 0
      if (!top) {
        element.style.removeProperty("--question-prompt-max-height")
        return
      }
      const dock = element.closest('[data-component="session-composer-dock"]')
      if (!(dock instanceof HTMLElement)) return
      const bottom = dock.getBoundingClientRect().bottom
      const below = Math.max(0, bottom - element.getBoundingClientRect().bottom)
      element.style.setProperty(
        "--question-prompt-max-height",
        `${Math.max(240, Math.floor(bottom - top - 8 - below))}px`,
      )
    }
    const update = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = undefined
        measure()
      })
    }
    const observer = new ResizeObserver(update)
    const dock = element.closest('[data-component="session-composer-dock"]')
    const scroller = document.querySelector(".scroll-view__viewport")
    if (dock) observer.observe(dock)
    if (scroller) observer.observe(scroller)
    window.addEventListener("resize", update)
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [])

  useLayoutEffect(() => {
    const element = options.current
    if (!element) return
    const update = () => services.measureOptions(element.scrollHeight)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [services])

  // Metadata updates retain focus; an explicit navigation request applies after the matching options commit.
  useLayoutEffect(() => {
    if (view.editing || view.minimized || view.optionsOff) return
    options.current?.querySelectorAll<HTMLButtonElement>('button[data-slot="question-option"]')[view.focus]?.focus()
  }, [view.focusRequest, view.optionsOff])

  return (
    <div data-component="session-question-dock">
      <div
        ref={root}
        data-component="dock-prompt"
        data-kind="question"
        onKeyDown={(event) => services.nav(event.nativeEvent)}
      >
        <div data-dock-surface="shell" data-slot="question-body">
          <div data-slot="question-header">
            <div data-slot="question-header-title">{view.summary}</div>
            <div data-slot="question-header-actions">
              {view.progress.length > 1 && (
                <div data-slot="question-progress">
                  {view.progress.map((question, index) => (
                    <Button
                      key={index}
                      variant="ghost"
                      size="sm"
                      data-slot="question-progress-segment"
                      className="size-6 rounded-sm border-0 p-0"
                      data-active={index === view.tab}
                      data-answered={question.answered}
                      disabled={view.sending}
                      onClick={() => services.jump(index)}
                      aria-label={question.label}
                    />
                  ))}
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0"
                disabled={view.sending}
                style={{ transform: `rotate(${view.hidden * 180}deg)` }}
                onClick={view.minimized ? services.restore : services.minimize}
                aria-label={language.t(view.minimized ? "session.question.restore" : "session.question.minimize")}
              >
                <Icon name="chevron-down" size="small" />
              </Button>
            </div>
          </div>
          <div data-slot="question-content">
            <div
              data-slot="question-text"
              style={{
                display: view.minimized ? "-webkit-box" : undefined,
                WebkitLineClamp: view.minimized ? 3 : undefined,
                WebkitBoxOrient: view.minimized ? "vertical" : undefined,
                overflow: view.minimized ? "hidden" : undefined,
              }}
            >
              {view.question}
            </div>
            {!view.minimized && (
              <div data-slot="question-hint">
                {language.t(view.multiple ? "ui.question.multiHint" : "ui.question.singleHint")}
              </div>
            )}
            <div
              ref={options}
              data-slot="question-options"
              aria-hidden={view.minimized || view.optionsOff || undefined}
              inert={view.minimized || view.optionsOff}
              className={view.hidden > 0.1 ? "pointer-events-none" : undefined}
              style={{
                maxHeight: `${Math.max(0, view.optionsHeight * (1 - view.hidden))}px`,
                opacity: Math.max(0, Math.min(1, 1 - view.hidden)),
                visibility: view.optionsOff ? "hidden" : "visible",
              }}
            >
              {view.options.map((option, index) => (
                <ListRow
                  key={option.value}
                  data-slot="question-option"
                  data-picked={option.picked}
                  role={view.multiple ? "checkbox" : "radio"}
                  aria-checked={option.picked}
                  disabled={view.sending}
                  selected={option.picked}
                  className="items-start whitespace-normal"
                  leading={<Mark multiple={view.multiple} picked={option.picked} />}
                  onFocus={() => services.focused(index)}
                  onClick={() => services.selectOption(index)}
                >
                  <span data-slot="question-option-main">
                    <span data-slot="option-label">{option.label}</span>
                    {option.description && <span data-slot="option-description">{option.description}</span>}
                  </span>
                </ListRow>
              ))}
              {view.editing ? (
                <form
                  data-slot="question-option"
                  className={listRow({ size: "md", interactive: true, selected: view.custom }).root({
                    class: "items-start",
                  })}
                  data-custom="true"
                  data-picked={view.custom}
                  role={view.multiple ? "checkbox" : "radio"}
                  aria-checked={view.custom}
                  onMouseDown={(event) => {
                    if (view.sending) {
                      event.preventDefault()
                      return
                    }
                    if (event.target instanceof HTMLTextAreaElement) return
                    event.currentTarget
                      .querySelector<HTMLTextAreaElement>('[data-slot="question-custom-input"]')
                      ?.focus()
                  }}
                  onSubmit={(event) => {
                    event.preventDefault()
                    services.commitCustom()
                  }}
                >
                  <Mark multiple={view.multiple} picked={view.custom} onToggle={services.customToggle} />
                  <span data-slot="question-option-main">
                    <span data-slot="option-label">{view.customLabel}</span>
                    <CustomAnswer services={services} view={view} />
                  </span>
                </form>
              ) : (
                <ListRow
                  data-slot="question-option"
                  data-custom="true"
                  data-picked={view.custom}
                  role={view.multiple ? "checkbox" : "radio"}
                  aria-checked={view.custom}
                  disabled={view.sending}
                  selected={view.custom}
                  className="items-start whitespace-normal"
                  onFocus={() => services.focused(view.options.length)}
                  onClick={services.customOpen}
                  leading={<Mark multiple={view.multiple} picked={view.custom} onToggle={services.customToggle} />}
                >
                  <span data-slot="question-option-main">
                    <span data-slot="option-label">{view.customLabel}</span>
                    <span data-slot="option-description" dir="auto">
                      {view.input || view.customPlaceholder}
                    </span>
                  </span>
                </ListRow>
              )}
            </div>
          </div>
        </div>
        <div data-dock-surface="tray" data-dock-attach="none" data-slot="question-footer">
          <Button
            variant="ghost"
            size="lg"
            disabled={view.sending}
            onClick={services.reject}
            aria-keyshortcuts="Escape"
          >
            {language.t("ui.common.dismiss")}
          </Button>
          <div data-slot="question-footer-actions">
            {view.tab > 0 && (
              <Tooltip
                content={`${language.t("ui.common.back")} · ${view.backShortcut}`}
                child={({ props: trigger }) => (
                  <Button
                    {...trigger}
                    variant="secondary"
                    size="lg"
                    disabled={view.sending}
                    onClick={services.back}
                    aria-keyshortcuts={view.backKeys}
                  >
                    {language.t("ui.common.back")}
                  </Button>
                )}
              />
            )}
            <Button
              variant={view.last ? "primary" : "secondary"}
              size="lg"
              disabled={view.sending}
              onClick={services.next}
              aria-keyshortcuts="Meta+Enter Control+Enter"
            >
              {language.t(view.last ? "ui.common.submit" : "ui.common.next")}
              <span data-slot="question-submit-shortcut" aria-hidden="true" className="text-11-medium opacity-60">
                {view.submitShortcut}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Mark(props: { multiple: boolean; picked: boolean; onToggle?: () => void }) {
  return (
    <span
      data-slot="question-option-check"
      aria-hidden="true"
      onClick={
        props.onToggle
          ? (event) => {
              event.preventDefault()
              event.stopPropagation()
              props.onToggle?.()
            }
          : undefined
      }
    >
      <span
        data-slot="question-option-box"
        data-type={props.multiple ? "checkbox" : "radio"}
        data-picked={props.picked}
      >
        {props.multiple ? (
          <Icon name="check-small" size="small" data-slot="icon-svg" />
        ) : (
          <span data-slot="question-option-radio-dot" />
        )}
      </span>
    </span>
  )
}

function CustomAnswer(props: { services: Services; view: View }) {
  const input = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (!input.current) return
    input.current.style.height = "0px"
    input.current.style.height = `${input.current.scrollHeight}px`
  }, [props.view.input])
  return (
    <Textarea
      ref={input}
      autoFocus
      data-slot="question-custom-input"
      aria-label={props.view.customLabel}
      dir="auto"
      placeholder={props.view.customPlaceholder}
      value={props.view.input}
      rows={1}
      disabled={props.view.sending}
      className="min-h-0 resize-none rounded-sm border-0 bg-transparent p-0 shadow-none"
      style={{ unicodeBidi: "plaintext", textAlign: "start" }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          props.services.cancelCustom()
          return
        }
        if ((event.metaKey || event.ctrlKey) && !event.altKey) return
        if (event.key !== "Enter" || event.shiftKey) return
        event.preventDefault()
        props.services.commitCustom()
      }}
      onValueChange={props.services.customUpdate}
    />
  )
}
