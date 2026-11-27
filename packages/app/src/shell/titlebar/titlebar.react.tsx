/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import { Tooltip } from "@reddb-io/design-system/base/Tooltip"
import type { TitlebarItem } from "@opencode/gui-extensions/sdk"
import type { SharedLanguage } from "@/runtime/react/language"
import type { SharedMount } from "@/runtime/react/mount"
import type { SharedSource } from "@/runtime/react/source"
import { SharedSlot } from "@/runtime/react/slot.react"
import { Icon } from "@/runtime/react/icon.react"
import { TitlebarItems } from "@/runtime/extension/titlebar-items.react"

type TitlebarSnapshot = {
  language: SharedLanguage
  mobile: boolean
  bottom: boolean
  web: boolean
  windows: boolean
  platformMenu: boolean
  mobileTop: boolean
  macTrafficLights: boolean
  zoom: number
  minHeight: string | undefined
  windowsControlsWidth: string
  showNavigation: boolean
  canBack: boolean
  canForward: boolean
  keybinds: { back: string[]; forward: string[] }
  channel: string | undefined
  debug: TitlebarItem | undefined
  items: TitlebarItem[]
}

// Native macOS controls: 14px inset, two 20px button pitches and a 14px button.
const macTrafficLightsBaseWidth = 68

// iOS Home Screen status-bar blur needs 16px clearance with a safe area, otherwise 8px.
const mobileTopClearance = "max(8px, min(16px, env(safe-area-inset-top, 0px) * 1000))"

export function TitlebarView(props: {
  source: SharedSource<TitlebarSnapshot>
  slots: Record<"platformMenu" | "right" | "mobileTabs" | "desktopTabs", SharedMount>
  back: () => void
  forward: () => void
}) {
  const view = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot)
  const language = view.language
  return (
    <header
      data-slot="titlebar-v2"
      className={`shrink-0 relative flex flex-row h-9 bg-v2-background-bg-deep overflow-visible ${view.bottom ? "order-last" : ""}`}
      style={{
        height: view.web
          ? view.bottom
            ? "calc(28px + max(8px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))))"
            : view.mobileTop
              ? `calc(28px + ${mobileTopClearance} + env(safe-area-inset-top, 0px))`
              : "calc(28px + max(8px, env(safe-area-inset-top, 0px)))"
          : undefined,
        paddingTop: view.bottom
          ? "0px"
          : view.mobileTop
            ? `calc(${mobileTopClearance} + env(safe-area-inset-top, 0px))`
            : "env(safe-area-inset-top, 0px)",
        paddingBottom: view.bottom ? "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))" : "0px",
        minHeight: view.minHeight,
        paddingLeft: view.macTrafficLights ? `${macTrafficLightsBaseWidth / view.zoom}px` : 0,
        width: view.windows ? `env(titlebar-area-width, calc(100vw - ${view.windowsControlsWidth}))` : undefined,
        maxWidth: view.windows ? `env(titlebar-area-width, calc(100vw - ${view.windowsControlsWidth}))` : undefined,
        marginRight: view.windows ? "auto" : undefined,
      }}
      data-tauri-drag-region=""
    >
      <div
        className={[
          "h-full flex-1 overflow-hidden flex flex-row items-center gap-1.5 px-2 md:pe-3",
          !view.bottom && !view.windows && !view.mobileTop
            ? "pt-[max(0px,calc(8px-env(safe-area-inset-top,0px)))]"
            : "",
          view.bottom ? "pb-[max(0px,calc(8px-var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))))]" : "",
          view.macTrafficLights ? "pl-4" : "",
          view.windows ? "ps-3.5" : "",
        ].join(" ")}
      >
        {!view.mobile && <ChannelIndicator view={view} />}
        {view.platformMenu && <SharedSlot mount={props.slots.platformMenu} />}
        {!view.mobile && view.showNavigation && (
          <div data-slot="titlebar-history" className="flex shrink-0 items-center gap-0.5 [app-region:no-drag]">
            <HistoryButton
              action="titlebar-back"
              label={language.t("common.goBack")}
              keys={view.keybinds.back}
              icon="arrow-left"
              disabled={!view.canBack}
              onClick={props.back}
            />
            <HistoryButton
              action="titlebar-forward"
              label={language.t("common.goForward")}
              keys={view.keybinds.forward}
              icon="arrow-right"
              disabled={!view.canForward}
              onClick={props.forward}
            />
          </div>
        )}
        {view.mobile ? <SharedSlot mount={props.slots.mobileTabs} /> : <SharedSlot mount={props.slots.desktopTabs} />}
        {!view.mobile && <div className="flex-1" />}
        <div className="relative z-20 flex shrink-0 items-center justify-end gap-0 overflow-visible">
          <TitlebarItems items={view.items} />
          <SharedSlot mount={props.slots.right} />
        </div>
      </div>
    </header>
  )
}

function HistoryButton(props: {
  action: string
  label: string
  keys: string[]
  icon: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Tooltip
      label={props.label}
      content={[props.label, ...props.keys].join(" ")}
      child={({ props: trigger }) => (
        <Button
          {...trigger}
          type="button"
          data-action={props.action}
          variant="ghost"
          size="sm"
          className="size-7 min-h-7 shrink-0 p-0 text-ink-muted"
          disabled={props.disabled}
          onClick={props.onClick}
          aria-label={props.label}
        >
          <Icon name={props.icon} />
        </Button>
      )}
    />
  )
}

function ChannelIndicator(props: { view: TitlebarSnapshot }) {
  const view = props.view
  const mark = (
    <svg data-titlebar-brand aria-hidden="true" viewBox="0 0 100 100" className="size-4 shrink-0">
      <path d="M0 0 H58 L100 38 V100 H0 Z" fill="#ff2056" />
      <g transform="translate(11.284 86.095) scale(0.0817 -0.0817)" className="titlebar-brand-letter">
        <path d="M66 0 L66 700 L370 700 Q436 700 485 677 Q534 654 561 612 Q588 570 588 513 L588 501 Q588 438 558 399 Q528 360 484 342 L484 324 Q524 322 546 296.5 Q568 271 568 229 L568 0 L436 0 L436 210 Q436 234 423.5 249 Q411 264 382 264 L198 264 L198 0 Z M198 370.28 L368.64 370.28 Q419.4 370.28 448.02 399.35 Q476.64 428.42 476.64 476.3 L476.64 487.7 Q476.64 535.58 448.56 564.65 Q420.48 593.72 368.64 593.72 L198 593.72 Z" />
      </g>
    </svg>
  )
  if (!view.debug) return <span className={`shrink-0 ${view.web ? "ps-2.5" : ""}`} aria-label="Redcode">{mark}</span>
  return (
    <div className={`me-1.5 shrink-0 [app-region:no-drag] ${view.web ? "ps-2.5" : ""}`}>
      <Tooltip
        label={view.debug.label}
        content={view.debug.label}
        child={({ props: trigger }) => (
          <button
            {...trigger}
            type="button"
            data-slot="channel-indicator"
            className="flex h-7 shrink-0 cursor-pointer items-center rounded-md px-1.5 [app-region:no-drag] hover:bg-foreground/8 active:bg-foreground/12 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
            onClick={() => view.debug?.run?.()}
            aria-label={view.debug?.label}
            aria-pressed={view.debug?.pressed}
          >
            {mark}
          </button>
        )}
      />
    </div>
  )
}
