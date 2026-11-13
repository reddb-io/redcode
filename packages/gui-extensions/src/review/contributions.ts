import type { FileDiffInfo } from "@opencode/client/promise"
import type {
  MountedSession,
  ReviewAnnotation,
  ReviewAnnotationContribution,
  ReviewHunk,
  ReviewLensContribution,
  SessionScreen,
} from "../sdk"

const HUNK = /^@@[^@]*@@/

type Patch = {
  readonly prefix: readonly string[]
  readonly hunks: readonly ReviewHunk[]
}

function parsePatch(patch: string): Patch {
  const lines = patch.split("\n")
  const first = lines.findIndex((line) => HUNK.test(line))

  if (first < 0) return { prefix: lines, hunks: [] }

  const hunks: ReviewHunk[] = []
  let header = ""
  let body: string[] = []

  for (const line of lines.slice(first)) {
    if (HUNK.test(line)) {
      if (header) hunks.push({ header, lines: body })
      header = line
      body = []
      continue
    }
    body.push(line)
  }
  if (header) hunks.push({ header, lines: body })

  return { prefix: lines.slice(0, first), hunks }
}

function count(lines: readonly string[], marker: "+" | "-") {
  return lines.filter((line) => line.startsWith(marker) && !line.startsWith(marker.repeat(3))).length
}

/** Applies installed review lenses while isolating one plugin's failure from every other contribution. */
export function applyReviewLenses(input: {
  readonly diffs: readonly FileDiffInfo[]
  readonly session: MountedSession
  readonly screen: SessionScreen
  readonly lenses: readonly ReviewLensContribution[]
  readonly report?: (owner: string, error: unknown) => void
}): FileDiffInfo[] {
  return input.diffs.flatMap((diff) => {
    const visible = input.lenses.every((lens) => {
      if (!lens.file || lens.signal.aborted) return true
      try {
        return lens.file({ session: input.session, screen: input.screen, file: diff.file, patch: diff.patch, signal: lens.signal })
      } catch (error) {
        input.report?.(lens.owner, error)
        return true
      }
    })

    if (!visible) return []

    const parsed = parsePatch(diff.patch)
    if (parsed.hunks.length === 0 || !input.lenses.some((lens) => lens.hunk && !lens.signal.aborted)) return [diff]

    const hunks = parsed.hunks.filter((hunk) =>
      input.lenses.every((lens) => {
        if (!lens.hunk || lens.signal.aborted) return true
        try {
          return lens.hunk({
            session: input.session,
            screen: input.screen,
            file: diff.file,
            patch: diff.patch,
            hunk,
            signal: lens.signal,
          })
        } catch (error) {
          input.report?.(lens.owner, error)
          return true
        }
      }),
    )

    if (hunks.length === 0) return []
    const body = hunks.flatMap((hunk) => [hunk.header, ...hunk.lines])

    return [
      {
        ...diff,
        patch: [...parsed.prefix, ...body].join("\n"),
        additions: count(body, "+"),
        deletions: count(body, "-"),
      },
    ]
  })
}

const MAX_ANNOTATIONS = 100
const MAX_TITLE = 160
const MAX_BODY = 2_000

/** Bounds and validates untrusted annotation results before they reach the diff renderer. */
export function boundReviewAnnotations(values: readonly ReviewAnnotation[]): ReviewAnnotation[] {
  const ids = new Set<string>()

  return values.slice(0, MAX_ANNOTATIONS).flatMap((value) => {
    if (!value.id || ids.has(value.id) || !Number.isSafeInteger(value.line) || value.line < 1) return []
    ids.add(value.id)

    return [
      {
        ...value,
        title: value.title.slice(0, MAX_TITLE),
        ...(value.body === undefined ? {} : { body: value.body.slice(0, MAX_BODY) }),
      },
    ]
  })
}

/** Loads one visible file's annotation sources independently, preserving successful results. */
export async function loadReviewAnnotations(input: {
  readonly sources: readonly ReviewAnnotationContribution[]
  readonly session: MountedSession
  readonly screen: SessionScreen
  readonly file: string
  readonly patch: string
  readonly signal: AbortSignal
  readonly report?: (owner: string, error: unknown) => void
}): Promise<ReviewAnnotation[]> {
  const groups = await Promise.all(
    input.sources.map(async (source) => {
      if (source.signal.aborted || input.signal.aborted) return []
      const controller = new AbortController()
      const abort = () => controller.abort()
      source.signal.addEventListener("abort", abort, { once: true })
      input.signal.addEventListener("abort", abort, { once: true })
      try {
        const values = await source.load({
          session: input.session,
          screen: input.screen,
          file: input.file,
          patch: input.patch,
          signal: controller.signal,
        })

        return controller.signal.aborted
          ? []
          : boundReviewAnnotations(values).map((value) => ({ ...value, id: `${source.owner}:${value.id}` }))
      } catch (error) {
        if (!controller.signal.aborted) input.report?.(source.owner, error)
        return []
      } finally {
        source.signal.removeEventListener("abort", abort)
        input.signal.removeEventListener("abort", abort)
      }
    }),
  )

  return boundReviewAnnotations(groups.flat())
}
