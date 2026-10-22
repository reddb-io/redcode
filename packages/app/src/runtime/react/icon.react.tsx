/** @jsxImportSource react */
import { useMemo, type ComponentProps } from "react"
import { getIcon, isIconName } from "@opencode/ui/icons/catalog"

/** Retain Redcode's product glyphs independently of its former renderer. */
export function Icon(props: { name: string; size?: "small" | "normal"; className?: string } & ComponentProps<"svg">) {
  const { name, size, ...rest } = props
  const icon = getIcon(isIconName(name) ? name : "plus")
  // Keep the SVG paths mounted when a tooltip rerenders between pointer down and release.
  const markup = useMemo(() => ({ __html: icon.body }), [icon.body])
  return (
    <svg
      {...rest}
      width={size === "small" ? 14 : 16}
      height={size === "small" ? 14 : 16}
      viewBox={icon.viewBox}
      fill="none"
      aria-hidden="true"
      dangerouslySetInnerHTML={markup}
    />
  )
}
