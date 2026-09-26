export interface Size {
  readonly width: number
  readonly height: number
}

export interface Rect extends Size {
  readonly x: number
  readonly y: number
}

/**
 * Where a preview frame's own coordinates land in the pane that shows it: the frame's CSS scale and the
 * pane position of its top-left corner. An unscaled frame has scale 1 and its offset as the origin; a
 * phone frame or a slide scaled to fit has a smaller scale.
 */
export interface Stage {
  readonly scale: number
  readonly x: number
  readonly y: number
}

/**
 * Geometry for a preview frame drawn scaled inside its pane: fitting it, and mapping what the frame
 * reports (element rects in its own CSS pixels) back onto the pane, where the note card sits.
 *
 * It is self-contained because review hosts serialize it into the standalone page with `toString()`.
 */
export function stage() {
  /**
   * Scales content down to fit the available box less a margin, centered in it; never up, unless `grow`
   * asks for it, as a slide shown full screen on a large display does.
   */
  const fit = (content: Size, available: Size, margin = 0, grow = false): Stage => {
    const room = { width: available.width - 2 * margin, height: available.height - 2 * margin }
    const ratio = Math.min(grow ? Infinity : 1, room.width / content.width, room.height / content.height)
    const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
    return {
      scale,
      x: Math.max(0, (available.width - content.width * scale) / 2),
      y: Math.max(0, (available.height - content.height * scale) / 2),
    }
  }
  /** A rect in the frame's coordinates, in the pane's. */
  const project = (rect: Rect, at: Stage): Rect => ({
    x: at.x + rect.x * at.scale,
    y: at.y + rect.y * at.scale,
    width: rect.width * at.scale,
    height: rect.height * at.scale,
  })
  /**
   * Where a card of the given size goes for an element: under it when it fits there or cannot go
   * above, over it otherwise, left-aligned with it, and always inside the pane's bounds.
   */
  const anchor = (rect: Rect, at: Stage, card: Size, bounds: Size) => {
    const target = project(rect, at)
    const below = target.y + target.height + 8
    const above = target.y - card.height - 8
    const top = below + card.height <= bounds.height || above < 0 ? below : above
    return {
      left: Math.round(Math.max(0, Math.min(target.x, bounds.width - card.width))),
      top: Math.round(Math.max(0, Math.min(top, bounds.height - card.height))),
    }
  }
  return { fit, project, anchor }
}
