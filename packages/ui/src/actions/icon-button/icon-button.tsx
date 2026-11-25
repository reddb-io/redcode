import { Root } from "@kobalte/core/button"
import { type ComponentProps, splitProps } from "solid-js"
import { JSX } from "solid-js"
import { button } from "@reddb-io/design-system/contracts/button"

export interface IconButtonProps
  extends ComponentProps<typeof Root>,
    Pick<ComponentProps<"button">, "class" | "classList"> {
  icon?: JSX.Element
  size?: "small" | "normal" | "large"
  variant?: "neutral" | "contrast" | "submit" | "ghost" | "ghost-muted"
  state?: "rest" | "hover" | "pressed"
}

export function IconButton(props: ComponentProps<"button"> & IconButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList", "state"])

  return (
    <Root
      {...rest}
      data-component="icon-button-v2"
      data-size={local.size || "normal"}
      data-variant={local.variant || "neutral"}
      data-state={local.state}
      class={button({
        size: local.size === "large" ? "md" : "sm",
        variant: variants[local.variant ?? "neutral"],
        class: [
          "shrink-0 aspect-square px-0 data-disabled:pointer-events-none data-disabled:opacity-50",
          local.state === "hover" &&
            (local.variant === "contrast" || local.variant === "submit"
              ? "bg-primary-active"
              : local.variant === "neutral" || !local.variant
                ? "border-foreground"
                : "bg-state-hover"),
          local.state === "pressed" &&
            (local.variant === "contrast" || local.variant === "submit" ? "bg-primary-active" : "bg-state-pressed"),
          local.class,
        ],
      })}
      classList={local.classList}
    >
      {local.icon}
    </Root>
  )
}

const variants = {
  neutral: "secondary",
  contrast: "primary",
  submit: "primary",
  ghost: "ghost",
  "ghost-muted": "ghost",
} as const satisfies Record<NonNullable<IconButtonProps["variant"]>, "primary" | "secondary" | "ghost">
