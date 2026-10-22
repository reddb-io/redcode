/** @jsxImportSource react */
import { button } from "@reddb-io/design-system/base/recipes"
import type { TitlebarItem } from "@opencode/gui-extensions/sdk"
import { Icon } from "@/runtime/react/icon.react"

/** Render ordered SDK contributions without moving their service ownership into React. */
export function TitlebarItems(props: { items: TitlebarItem[] }) {
  return props.items.map((item) => (
    <div
      key={item.id}
      data-slot="titlebar-update"
      className="group relative me-3 h-5 w-5 shrink-0 rounded-full bg-v2-background-bg-deep transition-[width] duration-150 ease-out hover:z-30 hover:w-[68px] focus-within:z-30 focus-within:w-[68px] motion-reduce:transition-none"
    >
      <button
        type="button"
        className={button({
          variant: "ghost",
          size: "sm",
          class:
            "absolute end-0 top-0 z-10 flex h-full min-h-0 w-full items-center justify-end gap-0 overflow-hidden rounded-full border-0 bg-v2-icon-icon-accent/20 p-0 text-v2-icon-icon-accent transition-[background-color] duration-150 ease-out group-hover:bg-[color-mix(in_srgb,var(--v2-icon-icon-accent)_20%,var(--v2-background-bg-deep))] group-focus-within:bg-[color-mix(in_srgb,var(--v2-icon-icon-accent)_20%,var(--v2-background-bg-deep))] disabled:opacity-60 motion-reduce:transition-none [app-region:no-drag]",
        })}
        onClick={() => item.run?.()}
        disabled={!!item.busy}
        aria-busy={!!item.busy}
        aria-label={item.title ?? item.label}
        aria-pressed={item.pressed}
      >
        <span className="ms-2 me-px shrink-0 translate-x-2 text-[11px] leading-4 text-v2-text-text-accent [font-weight:530] opacity-0 motion-safe:transition-all duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100 motion-reduce:translate-x-0 rtl:-translate-x-2">
          {item.label}
        </span>
        <span className="flex size-5 shrink-0 items-center justify-center">
          {item.busy ? (
            <span data-slot="titlebar-update-loader" aria-hidden="true" />
          ) : item.icon ? (
            <Icon name={item.icon} size="small" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 11V3M3.5 7.63128L7 11L10.5 7.63128" stroke="currentColor" />
            </svg>
          )}
        </span>
      </button>
    </div>
  ))
}
