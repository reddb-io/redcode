/** @jsxImportSource react */
import type { ComponentProps } from "react"
import { iconNames } from "@opencode/ui/icons/provider"
import sprite from "@opencode/ui/provider-icon-sprite.svg"

export function ProviderIcon(props: { provider: string } & ComponentProps<"svg">) {
  const { provider, ...rest } = props
  const name = iconNames.find((name) => name === provider) ?? "synthetic"
  return (
    <svg {...rest} data-component="provider-icon" aria-hidden="true">
      <use href={`${sprite}#${name}`} />
    </svg>
  )
}
