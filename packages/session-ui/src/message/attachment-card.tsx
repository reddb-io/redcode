import type { JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { card } from "@reddb-io/design-system/contracts/card"

const slots = card({ padding: "sm" })

/** Shared 160px two-line card used by file and comment attachments. */
export function AttachmentCard(props: {
  title: string
  active?: boolean
  clickable?: boolean
  wide?: boolean
  surface?: "base"
  /** native title attribute */
  hover?: string
  titleRef?: (element: HTMLSpanElement) => void
  onClick?: () => void
  children: JSX.Element
}) {
  const interactive = () => props.clickable ?? !!props.onClick
  return (
    <Dynamic
      component={interactive() ? "button" : "div"}
      type={interactive() ? "button" : undefined}
      class={slots.root({
        class: [
          "min-w-0 max-w-full items-stretch gap-[var(--reddb-spatial-gap-sm)] p-[var(--reddb-spatial-inset-sm)] text-start",
          props.wide ? "w-full" : "w-40",
          props.surface === "base" && "bg-elevation-base-surface",
          props.active && "border-control-edge",
          interactive() &&
            "cursor-pointer hover:border-control-edge focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        ],
      })}
      data-component="attachment-card"
      data-active={props.active ? "true" : undefined}
      data-clickable={interactive() ? "true" : undefined}
      data-wide={props.wide ? "true" : undefined}
      data-surface={props.surface}
      title={props.hover}
      onClick={props.onClick}
    >
      <span
        ref={(element) => props.titleRef?.(element)}
        data-slot="attachment-card-title"
        class={slots.title({ class: "block w-full truncate text-label leading-text-compact" })}
      >
        {props.title}
      </span>
      <span
        data-slot="attachment-card-subtitle"
        class={slots.description({
          class:
            "flex min-w-0 items-center gap-[var(--reddb-spatial-gap-sm)] overflow-hidden whitespace-nowrap text-caption leading-text-compact [&>svg]:size-3 [&>svg]:shrink-0 [&>span]:truncate",
        })}
      >
        {props.children}
      </span>
    </Dynamic>
  )
}
