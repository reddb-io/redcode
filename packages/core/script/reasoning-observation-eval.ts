import { ReasoningObserver } from "@opencode/core/session/reasoning-observer"
import { CORPUS_VERSION, chunkEvents, chunkings, corpus } from "../test/fixture/reasoning-observation"

/** Deterministic synthetic correctness report; contains no provider calls or timing claims. */
export function evaluate() {
  const matrix = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 }
  const state = { lineCodeUnits: 0, prefixCodeUnits: 0, recentSegments: 0, periodicCodeUnits: 0, periodicChecks: 0 }
  const cases = corpus.map((fixture) => {
    const runs = chunkings.map((chunking) => {
      const observer = ReasoningObserver.make()
      chunkEvents(fixture.events, chunking).forEach(observer.observe)
      const result = observer.finish()
      state.lineCodeUnits = Math.max(state.lineCodeUnits, result.maxLineCodeUnits)
      state.prefixCodeUnits = Math.max(state.prefixCodeUnits, result.maxPrefixCodeUnits)
      state.recentSegments = Math.max(state.recentSegments, result.maxRecentSegments)
      state.periodicCodeUnits = Math.max(state.periodicCodeUnits, result.maxPeriodicCodeUnits)
      state.periodicChecks = Math.max(state.periodicChecks, result.periodicChecks)
      return { chunking, ...result }
    })
    const observed = runs[0].observation !== undefined
    matrix[
      fixture.repeated ? (observed ? "truePositive" : "falseNegative") : observed ? "falsePositive" : "trueNegative"
    ]++
    const baseline = JSON.stringify({ ...runs[0], chunking: undefined })
    return {
      id: fixture.id,
      expected: fixture.repeated,
      observed,
      kind: runs[0].observation?.kind,
      correct: observed === fixture.repeated && (!fixture.kind || runs[0].observation?.kind === fixture.kind),
      knownFalsePositive: fixture.knownFalsePositive ?? false,
      matchesBaseline:
        observed === (fixture.repeated || Boolean(fixture.knownFalsePositive)) &&
        (!fixture.kind || runs[0].observation?.kind === fixture.kind),
      chunkInvariant: runs.every((run) => JSON.stringify({ ...run, chunking: undefined }) === baseline),
    }
  })
  return {
    corpus: CORPUS_VERSION,
    detector: ReasoningObserver.VERSION,
    cases,
    matrix,
    knownFalsePositives: cases.filter((fixture) => fixture.knownFalsePositive).map((fixture) => fixture.id),
    chunkings: chunkings.length,
    chunkInvariant: cases.every((fixture) => fixture.chunkInvariant),
    state,
    limits: ReasoningObserver.LIMITS,
    bounded:
      state.lineCodeUnits <= ReasoningObserver.LIMITS.line &&
      state.prefixCodeUnits <= ReasoningObserver.LIMITS.prefix &&
      state.recentSegments <= ReasoningObserver.LIMITS.segments &&
      state.periodicCodeUnits <= ReasoningObserver.LIMITS.periodic,
  }
}

if (import.meta.main) {
  const report = evaluate()
  console.log(JSON.stringify(report, null, 2))
  if (
    process.argv.includes("--check") &&
    (!report.chunkInvariant || !report.bounded || report.cases.some((fixture) => !fixture.matchesBaseline))
  )
    process.exitCode = 1
}
