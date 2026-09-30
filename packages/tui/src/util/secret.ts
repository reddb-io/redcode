import type { KeyEvent } from "@opentui/core"

const MASK_WIDTH = 40

/** What a masked field draws for a value of `length` characters: bullets only, so the value never reaches the screen. */
export function secretMask(length: number) {
  if (length <= MASK_WIDTH) return "•".repeat(length)
  return `${"•".repeat(MASK_WIDTH)} +${length - MASK_WIDTH}`
}

/** How many characters a masked field reports for `value`, counting code points rather than UTF-16 units. */
export function secretLength(value: string) {
  return Array.from(value).length
}

/**
 * `value` after one key press, or undefined when the key is not text editing and belongs to another binding, such as
 * enter, escape or a modified shortcut.
 */
export function secretKey(
  value: string,
  event: Pick<KeyEvent, "name" | "sequence" | "ctrl" | "meta" | "option" | "super" | "hyper">,
) {
  if (event.ctrl || event.meta || event.option || event.super || event.hyper) return
  if (event.name === "backspace") return Array.from(value).slice(0, -1).join("")
  if (!/^[^\p{C}\p{Zl}\p{Zp}]+$/u.test(event.sequence)) return
  return value + event.sequence
}

/** `value` with pasted `text` appended; a copied token's surrounding line breaks are dropped, inner ones kept. */
export function secretPaste(value: string, text: string) {
  return value + text.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "")
}
