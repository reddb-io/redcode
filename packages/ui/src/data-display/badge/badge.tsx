import { type ComponentProps, splitProps } from "solid-js"
import { badge } from "@reddb-io/design-system/contracts/badge"

export interface BadgeProps extends ComponentProps<"span"> {
  appearance?: "standard" | "compact"
  variant?: "neutral" | "accent"
}

export function Badge(props: BadgeProps) {
  const [split, rest] = splitProps(props, ["class", "classList", "children", "appearance", "variant"])

  return (
    <span
      {...rest}
      data-component="tag"
      data-appearance={split.appearance ?? "compact"}
      data-variant={split.variant ?? "neutral"}
      class={badge({
        variant: split.variant === "accent" ? "filled" : "tinted",
        class: [split.appearance !== "standard" && "py-0", "data-high-contrast:border-control-edge", split.class],
      })}
      classList={split.classList}
    >
      {split.children}
    </span>
  )
}
