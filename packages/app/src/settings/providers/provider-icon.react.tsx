/** @jsxImportSource react */
import { iconNames } from "@opencode/ui/icons/provider"
import sprite from "../../../../ui/src/components/provider-icons/sprite.svg"
import customManagedProvider from "@/providers/custom-managed-provider.svg"

export function ProviderModelIcon(props: { provider: { id: string; canonical?: string }; className?: string }) {
  const icon = [
    props.provider.canonical,
    props.provider.canonical?.replace(/-token-plan$/, ""),
    props.provider.id.replace(/^console-/, ""),
  ].find((id) => !!id && id !== "synthetic" && iconNames.some((name) => name === id))
  if (props.provider.id === "opencode") return <OpenCodeLogo className={`size-4 ${props.className ?? ""}`} />
  if (icon)
    return (
      <svg data-component="provider-icon" width={16} height={16} aria-hidden="true" className={props.className}>
        <use href={`${sprite}#${icon}`} />
      </svg>
    )
  return (
    <img
      data-component="custom-managed-provider-icon"
      src={customManagedProvider}
      alt=""
      className={`size-4 ${props.className ?? ""}`}
    />
  )
}
export function OpenCodeLogo(props: { className?: string }) {
  return (
    <svg
      data-component="opencode-logo"
      aria-hidden="true"
      className={props.className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(1.2 1.2) scale(0.85)">
        <path opacity="0.2" d="M11.1999 12.8H4.79993V6.40002H11.1999V12.8Z" fill="currentColor" />
        <path d="M11.2 3.2H4.79998V12.8H11.2V3.2ZM14.4 16H1.59998V0H14.4V16Z" fill="currentColor" />
      </g>
    </svg>
  )
}
