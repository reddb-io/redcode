/** @jsxImportSource react */
import type { ComponentProps } from "react"
import { getIcon, isIconName } from "@opencode/ui/icons/catalog"

/** Retain Redcode's product glyphs independently of its former renderer. */
export function SettingsIcon(
  props: { name: string; size?: "small" | "normal"; className?: string } & ComponentProps<"svg">,
) {
  const { name, size, ...rest } = props
  const icon = getIcon(isIconName(name) ? name : "plus")
  return (
    <svg
      {...rest}
      width={size === "small" ? 14 : 16}
      height={size === "small" ? 14 : 16}
      viewBox={icon.viewBox}
      fill="none"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  )
}
