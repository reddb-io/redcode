/**
 * The states a design must answer.
 *
 * The single most reliable failure of generated UI is shipping only the populated state: the
 * loading, empty, error and edge cases then get decided by whoever implements it, without the
 * person who asked for the design in the room. The prompt already asks for them. This makes the
 * ask checkable, so a missing state becomes a question in `design.json` instead of a surprise later.
 *
 * The contract is one attribute: `data-state="loading|empty|error|populated|edge"` on whatever
 * element renders that state. Any element, any depth, as many times as the prototype likes.
 */

export const STATES = ["loading", "empty", "error", "populated", "edge"] as const
export type State = (typeof STATES)[number]

/** Why each state matters, in the words the question in the manifest will use. */
export const QUESTION: Record<State, string> = {
  loading: "What does this look like while data is in flight, and after it takes too long?",
  empty: "What does this look like with nothing in it — first use, and a search with no results?",
  error: "What does this look like when it fails: what happened, why, and what can the user do?",
  populated: "What does this look like with real data in it?",
  edge: "What happens with too much content, the longest plausible name, or a missing optional field?",
}

/** The prefix that makes a state question recognisable, so it can be removed once answered. */
export const QUESTION_PREFIX = "state:"

export function question(state: State) {
  return `${QUESTION_PREFIX}${state} — ${QUESTION[state]}`
}

export interface Coverage {
  readonly present: ReadonlySet<State>
  readonly missing: readonly State[]
}

const ATTR = /data-state\s*=\s*["']?\s*([a-z-]+)/gi

export function states(html: string): Coverage {
  const present = new Set<State>()
  const source = html.replace(/<!--[\s\S]*?-->/g, "")
  for (const match of source.matchAll(ATTR)) {
    const value = match[1]?.toLowerCase()
    if ((STATES as readonly string[]).includes(value ?? "")) present.add(value as State)
  }
  return { present, missing: STATES.filter((state) => !present.has(state)) }
}

/**
 * Bring the manifest's questions in line with what the prototype answers: one question per
 * missing state, none for a state that is now rendered. Other questions are left alone.
 */
export function syncQuestions(questions: readonly string[], coverage: Coverage): string[] {
  const kept = questions.filter((item) => !item.startsWith(QUESTION_PREFIX))
  return [...kept, ...coverage.missing.map(question)]
}

/** The tool-output paragraph, or nothing when every state is there. */
export function report(coverage: Coverage) {
  if (coverage.missing.length === 0) return undefined
  return [
    `States missing: ${coverage.missing.join(", ")}. Each is a question the implementation will answer without you unless the prototype answers it.`,
    `Mark the element that renders each with data-state="…" (loading, empty, error, populated, edge). The questions are now in design.json.`,
  ].join("\n")
}

export * as DesignStates from "./states"
