import { createSignal, onCleanup, Show } from "solid-js"
import { DEFAULT_SYMBOL_PX, logoBox, px } from "@reddb-io/design-system/logo/box"
import { selectMark, type LogoLayout, type LogoSurface } from "@reddb-io/design-system/logo/marks"
import { observeActiveSurface } from "@reddb-io/design-system/logo/surface"
import { logo, logoMark } from "@reddb-io/design-system/logo/variants"

/**
 * The design system's Base Kit Logo for Solid. Redcode carries the RedDB brand, and the Kit's Logo is Svelte, so
 * this places the same Brand Marks through the Kit's own selection, clearspace and minimum-size modules. A Mark the
 * pinned release does not ship and a size below the minimum both throw instead of falling back (DS ADR 0004).
 *
 * `on` names the surface behind the Mark and follows the root Color Scheme when omitted; `size` is the symbol's height
 * in CSS pixels, and the box is larger by the clearspace on every side.
 */
export const Logo = (props: {
  layout?: LogoLayout
  on?: LogoSurface
  size?: number
  href?: string
  label?: string
  loading?: "eager" | "lazy"
  class?: string
}) => {
  const [observed, setObserved] = createSignal<LogoSurface>("light")
  onCleanup(observeActiveSurface(setObserved))
  const mark = () => selectMark(props.layout ?? "horizontal", props.on ?? observed())
  const box = () => logoBox(mark(), props.size ?? DEFAULT_SYMBOL_PX)
  const image = () => (
    <img
      src={mark().src}
      alt={props.href === undefined ? "RedDB" : ""}
      width={Math.round(box().markWidth)}
      height={Math.round(box().markHeight)}
      style={{ width: px(box().markWidth), height: px(box().markHeight) }}
      class={logoMark()}
      loading={props.loading ?? "eager"}
      decoding="async"
      draggable={false}
      aria-hidden={props.href === undefined ? undefined : "true"}
    />
  )
  const attributes = () => ({
    class: logo({ interactive: props.href !== undefined, class: props.class }),
    style: { padding: px(box().clearspace) },
    "data-logo-layout": props.layout ?? "horizontal",
    "data-logo-on": props.on ?? observed(),
    "data-logo-mark": mark().file,
  })

  return (
    <Show when={props.href} fallback={<span {...attributes()}>{image()}</span>}>
      {(href) => (
        <a {...attributes()} href={href()} aria-label={props.label ?? "Redcode home"}>
          {image()}
        </a>
      )}
    </Show>
  )
}
