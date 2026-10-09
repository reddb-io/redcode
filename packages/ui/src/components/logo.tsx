import endorsementColor from "../design-system/vendor/endorsement/reddb-endorsement-color.svg"
import endorsementInverse from "../design-system/vendor/endorsement/reddb-endorsement-inverse.svg"

// Redcode is a sibling product of the reddb.io house (brand identity/house.md, ADRs 0008 and 0009): it inherits the
// house red, typefaces and neutrals, never RedDB's mark, and it has no symbol of its own yet. Until the Brand issues
// one, the product is named in its typeface and signed with the house endorsement mark.

/** The product name set in the house typeface: Space Grotesk 700, tight tracking. */
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -740 4140 760"
      fill="none"
      role="img"
      aria-label="Redcode"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <text
        x="0"
        y="0"
        fill="var(--icon-strong-base)"
        font-family="var(--reddb-font-family-sans)"
        font-size="1000"
        font-weight="700"
        letter-spacing="-20"
      >
        Redcode
      </text>
    </svg>
  )
}

/**
 * The reddb.io house endorsement mark, unaltered, for a footer line. Clearspace is a quarter of its height and the
 * minimum height is 16px; the color lockup sits on light grounds and the inverse on dark ones.
 */
export const Endorsement = (props: { class?: string }) => {
  return (
    <span
      data-component="reddb-endorsement"
      role="img"
      aria-label="reddb.io"
      classList={{ "inline-flex shrink-0": true, [props.class ?? ""]: !!props.class }}
    >
      <img
        src={endorsementColor}
        alt=""
        draggable={false}
        class="h-full w-auto [[data-color-scheme=dark]_&]:hidden"
      />
      <img
        src={endorsementInverse}
        alt=""
        draggable={false}
        class="hidden h-full w-auto [[data-color-scheme=dark]_&]:block"
      />
    </span>
  )
}
