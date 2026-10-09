import { createUniqueId, type ComponentProps } from "solid-js"
import { MARK, WORD } from "../../components/logo"

/**
 * The `>_ redcode` wordmark as a decorative backdrop (splash, server connect). It keeps the inherited presentation
 * switches: `muted` lowers its weight, `fade` dissolves the lower half and `outline` draws strokes for an entry
 * animation. The prompt glyph keeps the Brand red unless the wordmark is outlined.
 */
export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -760 5160 960"
      fill="none"
      role="img"
      aria-label="Redcode"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            <path
              pathLength={props.outline ? 1 : undefined}
              d={MARK}
              fill={props.outline ? undefined : "var(--reddb-color-primary)"}
            />
            <path pathLength={props.outline ? 1 : undefined} d={WORD} />
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="-760" width="5160" height="960">
          <rect x="0" y="-760" width="5160" height="960" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="2580" y1="-260" x2="2580" y2="200" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
