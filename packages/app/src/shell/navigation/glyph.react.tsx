/** @jsxImportSource react */
import { navigationGlyphs } from "./glyphs"

export function Glyph(props: { name: keyof typeof navigationGlyphs; className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${props.className ?? ""}`}
    >
      <path d={navigationGlyphs[props.name]} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
