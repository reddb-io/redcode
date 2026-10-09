import { createUniqueId, type ComponentProps } from "solid-js"

/**
 * The product name as a decorative backdrop (splash, server connect), set in the house typeface. Redcode has no
 * symbol of its own yet (see components/logo.tsx). `muted` lowers its weight, `fade` dissolves the lower part and
 * `outline` draws it as strokes for the first-launch entry animation.
 */
export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -740 4140 760"
      fill="none"
      role="img"
      aria-label="Redcode"
      classList={{ [props.class ?? ""]: !!props.class, "overflow-visible": props.outline }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <text
            x="0"
            y="0"
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 6 : undefined}
            font-family="var(--reddb-font-family-sans)"
            font-size="1000"
            font-weight="700"
            letter-spacing="-20"
          >
            Redcode
          </text>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="-740" width="4140" height="760">
          <rect x="0" y="-740" width="4140" height="760" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="2070" y1="-360" x2="2070" y2="20" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
