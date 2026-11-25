import { button } from "@reddb-io/design-system/contracts/button"
import { Root } from "@kobalte/core/button"
import { type ComponentProps, Show, splitProps } from "solid-js"
import { Icon, type IconProps } from "@opencode/ui/icon"
import "./button.css"

export interface ButtonProps
  extends ComponentProps<typeof Root>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  size?: "small" | "normal" | "large"
  variant?:
    | "neutral"
    | "danger"
    | "warning"
    | "outline"
    | "contrast"
    | "submit"
    | "ghost"
    | "ghost-muted"
    | "ghost-faint"
    | "loading"
  icon?: IconProps["name"]
}

export function Button(props: ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList"])

  return (
    <Root
      {...rest}
      data-component="button-v2"
      data-size={split.size || "normal"}
      data-variant={split.variant || "neutral"}
      data-icon={split.icon}
      class={button({
        size: split.size === "small" ? "sm" : split.size === "large" ? "lg" : "md",
        variant: variants[split.variant ?? "neutral"],
        tone: split.variant === "danger" || split.variant === "warning" ? split.variant : "neutral",
        class: split.class,
      })}
      classList={split.classList}
    >
      <Show when={split.icon}>{(icon) => <Icon name={icon()} />}</Show>
      {props.children}
    </Root>
  )
}

const variants = {
  neutral: "secondary",
  danger: "secondary",
  warning: "secondary",
  outline: "secondary",
  contrast: "primary",
  submit: "primary",
  ghost: "ghost",
  "ghost-muted": "ghost",
  "ghost-faint": "ghost",
  loading: "secondary",
} as const satisfies Record<NonNullable<ButtonProps["variant"]>, "secondary" | "primary" | "ghost">
