import { LLMEvent } from "@opencode/ai"
import type { ReasoningObserver } from "@opencode/core/session/reasoning-observer"

export const CORPUS_VERSION = "synthetic-reasoning-1"
export const repeatedLine = "I need to reconsider the same unresolved choice."
export const repeatedLines = (count: number) => `${Array.from({ length: count }, () => repeatedLine).join("\n")}\n`
const block = (text: string, id = "reasoning-fixture") => [
  LLMEvent.reasoningStart({ id }),
  LLMEvent.reasoningDelta({ id, text }),
  LLMEvent.reasoningEnd({ id }),
]
const lines = (values: readonly string[], count: number) =>
  `${Array.from({ length: count }, (_, index) => values[index % values.length]).join("\n")}\n`

export const corpus: ReadonlyArray<{
  readonly id: string
  readonly repeated: boolean
  readonly knownFalsePositive?: true
  readonly kind?: ReasoningObserver.Observation["kind"]
  readonly events: readonly LLMEvent[]
}> = [
  { id: "consecutive-lines", repeated: true, kind: "consecutive", events: block(repeatedLines(12)) },
  {
    id: "information-prefix-is-prose",
    repeated: true,
    kind: "consecutive",
    events: block(lines(["Information about this same unresolved choice still needs reconsideration."], 12)),
  },
  {
    id: "consecutive-with-whitespace-and-case",
    repeated: true,
    kind: "consecutive",
    events: block(lines([repeatedLine, ` ${repeatedLine.toUpperCase().replaceAll(" ", "  ")} `], 12)),
  },
  {
    id: "two-line-cycle",
    repeated: true,
    kind: "cycle",
    events: block(
      lines(["I need to inspect the unresolved alternative.", "I need to reconsider the original choice."], 24),
    ),
  },
  {
    id: "eight-line-cycle",
    repeated: true,
    kind: "cycle",
    events: block(
      lines(
        Array.from({ length: 8 }, (_, index) => `Reconsider unresolved alternative number ${index}.`),
        24,
      ),
    ),
  },
  { id: "long-periodic-line", repeated: true, kind: "periodic", events: block("reconsider ".repeat(120)) },
  {
    id: "trailing-line-on-error",
    repeated: true,
    kind: "consecutive",
    events: [
      LLMEvent.reasoningStart({ id: "partial" }),
      LLMEvent.reasoningDelta({ id: "partial", text: repeatedLines(12).trimEnd() }),
    ],
  },
  {
    id: "authoritative-end-without-deltas",
    repeated: true,
    kind: "consecutive",
    events: [
      LLMEvent.reasoningStart({ id: "end-only" }),
      LLMEvent.reasoningEnd({ id: "end-only", text: repeatedLines(12) }),
    ],
  },
  { id: "below-consecutive-threshold", repeated: false, events: block(repeatedLines(11)) },
  { id: "short-confirmations", repeated: false, events: block(lines(["Okay.", "Next."], 80)) },
  {
    id: "legitimate-progressive-prose",
    repeated: false,
    events: block(
      Array.from(
        { length: 80 },
        (_, index) => `The evidence now establishes a distinct result for checkpoint ${index}.`,
      ).join("\n"),
    ),
  },
  { id: "quoted-markdown", repeated: false, events: block(lines([`> ${repeatedLine}`], 80)) },
  { id: "quoted-literal", repeated: false, events: block(lines([`"${repeatedLine}"`], 80)) },
  { id: "quoted-periodic-line", repeated: false, events: block(`'${"reconsider ".repeat(120)}'`) },
  {
    id: "inline-quote-known-false-positive",
    repeated: false,
    knownFalsePositive: true,
    kind: "periodic",
    events: block(`Quoted source: "${"reconsider ".repeat(120)}"`),
  },
  { id: "fenced-code", repeated: false, events: block(`\`\`\`ts\n${repeatedLines(80)}\`\`\`\n`) },
  {
    id: "longer-fence-with-literal-shorter-fence",
    repeated: false,
    events: block(`\`\`\`\`md\n\`\`\`\n${repeatedLines(80)}\`\`\`\`\n`),
  },
  { id: "tilde-fenced-code", repeated: false, events: block(`~~~\n${"reconsider ".repeat(120)}\n~~~\n`) },
  { id: "indented-code", repeated: false, events: block(lines([`    ${repeatedLine}`], 80)) },
  { id: "tab-indented-code", repeated: false, events: block(lines([`\t${repeatedLine}`], 80)) },
  { id: "bracketed-log", repeated: false, events: block(lines([`[INFO] ${repeatedLine}`], 80)) },
  { id: "level-log", repeated: false, events: block(lines([`ERROR ${repeatedLine}`], 80)) },
  { id: "timestamp-log", repeated: false, events: block(lines([`2026-10-02T10:00:00Z ${repeatedLine}`], 80)) },
  { id: "time-log", repeated: false, events: block(lines([`10:00:00 ${repeatedLine}`], 80)) },
  { id: "separator-lines", repeated: false, events: block(lines(["-----------------------------"], 80)) },
  { id: "separator-tail", repeated: false, events: block("=+- ".repeat(2_000)) },
  { id: "blank-line-reset", repeated: false, events: block(`${repeatedLines(6)}\n${repeatedLines(6)}`) },
  {
    id: "block-reset",
    repeated: false,
    events: [...block(repeatedLines(6), "first"), ...block(repeatedLines(6), "second")],
  },
  {
    id: "productive-text-reset",
    repeated: false,
    events: [
      LLMEvent.reasoningStart({ id: "mixed" }),
      LLMEvent.reasoningDelta({ id: "mixed", text: repeatedLines(6) }),
      LLMEvent.textDelta({ id: "answer", text: "A useful result is now available." }),
      LLMEvent.reasoningDelta({ id: "mixed", text: repeatedLines(6) }),
      LLMEvent.reasoningEnd({ id: "mixed" }),
    ],
  },
  {
    id: "tool-progress-reset",
    repeated: false,
    events: [
      LLMEvent.reasoningStart({ id: "tools" }),
      LLMEvent.reasoningDelta({ id: "tools", text: repeatedLines(6) }),
      LLMEvent.toolCall({ id: "read", name: "read", input: { path: "README.md" }, providerExecuted: true }),
      LLMEvent.reasoningDelta({ id: "tools", text: repeatedLines(6) }),
      LLMEvent.reasoningEnd({ id: "tools" }),
    ],
  },
  {
    id: "authoritative-end-does-not-double-deltas",
    repeated: false,
    events: [
      LLMEvent.reasoningStart({ id: "complete" }),
      LLMEvent.reasoningDelta({ id: "complete", text: repeatedLines(6) }),
      LLMEvent.reasoningEnd({ id: "complete", text: repeatedLines(6) }),
    ],
  },
  { id: "long-unbroken-negative", repeated: false, events: block("x".repeat(65_536)) },
  {
    id: "crlf-consecutive-lines",
    repeated: true,
    kind: "consecutive",
    events: block(repeatedLines(12).replaceAll("\n", "\r\n")),
  },
]

export const chunkings = ["whole", "single-code-unit", "uneven"] as const
export function chunkEvents(events: readonly LLMEvent[], chunking: (typeof chunkings)[number]) {
  return events.flatMap((event) => {
    if (event.type !== "reasoning-delta" || chunking === "whole") return [event]
    const chunks: LLMEvent[] = []
    for (let index = 0; index < event.text.length; ) {
      const size = chunking === "single-code-unit" ? 1 : [1, 7, 31, 2, 113][chunks.length % 5]
      chunks.push(LLMEvent.reasoningDelta({ ...event, text: event.text.slice(index, index + size) }))
      index += size
    }
    return chunks
  })
}
