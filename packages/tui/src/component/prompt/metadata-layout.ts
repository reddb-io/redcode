import { Locale } from "../../util/locale"
import { stringWidth } from "../../util/string-width"

/** Below this terminal width the dim route hint is never shown, even when it would fit. */
const ROUTE_MIN_WIDTH = 100
/** The spare columns the right-aligned route hint keeps from the model line before it is shown. */
const ROUTE_GAP = 2
const S1_WIDE = 24
const S1_NARROW = 12

export type PromptMetadataLayout = {
  agent?: string
  auto?: boolean
  model: string
  variant?: string
  s1?: string
  route?: string
}

/**
 * How the prompt footer's compact model line (`<agent> · <model>·<variant> ⁄ <s1>`, with the route
 * chain dim and right-aligned when there is room) gives up width. The route hint goes first, then the
 * S1 name truncates and finally disappears, then the `auto` marker, then the agent. The S2 model name
 * is never shortened for width: it is the last thing standing as the terminal narrows.
 */
export function promptMetadataLayout(input: {
  width: number
  terminalWidth: number
  agent: string
  auto: boolean
  model: string
  variant?: string
  s1?: { model: string; provider: string }
  provider: string
}): PromptMetadataLayout {
  const agent = input.terminalWidth < 44 || !input.agent ? undefined : input.agent
  const s1 = input.s1?.model
  const route =
    input.terminalWidth >= ROUTE_MIN_WIDTH
      ? [input.provider, input.s1?.provider].filter(Boolean).join(" · ") || undefined
      : undefined
  const base = { agent, model: input.model, variant: input.variant }
  const candidates: PromptMetadataLayout[] = [
    { ...base, auto: input.auto, s1, route },
    { ...base, auto: input.auto, s1 },
    { ...base, auto: input.auto, s1: s1 && Locale.truncateWidth(s1, S1_WIDE) },
    { ...base, auto: input.auto, s1: s1 && Locale.truncateWidth(s1, S1_NARROW) },
    { ...base, auto: input.auto },
    base,
    { model: input.model, variant: input.variant },
  ]
  return (
    candidates.find((candidate) => promptMetadataWidth(candidate) <= input.width) ?? {
      model: input.model,
      variant: input.variant,
    }
  )
}

/** The columns a layout takes as rendered: parts joined by one-column gaps, plus the route's spare gap. */
export function promptMetadataWidth(layout: PromptMetadataLayout) {
  const line = [
    layout.agent,
    layout.auto ? "auto" : undefined,
    layout.agent ? "·" : undefined,
    layout.variant ? `${layout.model}·${layout.variant}` : layout.model,
    layout.s1 ? `⁄ ${layout.s1}` : undefined,
  ]
    .filter((part): part is string => !!part)
    .join(" ")
  return stringWidth(line) + (layout.route ? ROUTE_GAP + stringWidth(layout.route) : 0)
}
