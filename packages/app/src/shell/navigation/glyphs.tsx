// Glyphs the shared icon set does not carry yet, drawn on its 16px grid with its 1px stroke.
const paths = {
  home: "M2.5 7 8 2.5 13.5 7v6.5h-4V10h-3v3.5h-4V7Z",
  pin: "M5.5 2.5h5M6.5 2.5v3.5L4.5 9h7l-2-3V2.5M8 9v4.5",
  activity: "M1.5 8.5h2.75L6 4l4 8 1.75-3.5h2.75",
} as const

export function Glyph(props: { name: keyof typeof paths; class?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      class={`shrink-0 ${props.class ?? ""}`}
    >
      <path d={paths[props.name]} stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}
