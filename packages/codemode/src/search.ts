/**
 * Keyword ranking over described tools, shared by `$codemode.search` and hosts that search
 * the same kind of catalog outside the interpreter.
 */

/**
 * Split a query into lowercased search terms. camelCase boundaries are split
 * (`resolveLibrary` -> `resolve library`) and every non-alphanumeric character is a
 * separator, so `resolve-library-id`, `resolveLibraryId`, and `resolve library id` all
 * tokenize alike. Empties and the `*` wildcard are dropped.
 */
export const tokenize = (query: string): Array<string> =>
  query
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0 && term !== "*")

/**
 * A term plus its naive singular variants (trailing "s"/"es" stripped), so a plural
 * query term ("issues") still matches indexed text that only carries the singular
 * ("issue"). Matching is one-directional substring containment, so the variants are
 * needed only on the query side; scoring weights are unchanged - each field check
 * passes when ANY form matches.
 */
export const termForms = (term: string): Array<string> => {
  const forms = [term]
  if (term.endsWith("es") && term.length > 3) forms.push(term.slice(0, -2))
  if (term.endsWith("s") && term.length > 2) forms.push(term.slice(0, -1))
  return forms
}

export type Candidate<A> = {
  /** Dotted path, `namespace.name`. */
  readonly path: string
  readonly description: string
  /** Lowercased path + description + input property names/descriptions. */
  readonly searchText: string
  readonly value: A
}

/**
 * Additive field-weighted scoring, summed across terms: exact path or path segment
 * (20) > path substring (8) > description substring (4) > any searchable text,
 * including input parameter names and descriptions (2). Ties break by path. An empty
 * query keeps every candidate in path order.
 */
export const rank = <A>(candidates: ReadonlyArray<Candidate<A>>, query: string): Array<Candidate<A>> => {
  const terms = tokenize(query).map(termForms)
  return candidates
    .map((candidate) => {
      const path = candidate.path.toLowerCase()
      const description = candidate.description.toLowerCase()
      const score = terms.reduce(
        (total, forms) =>
          total +
          (forms.some((form) => path === form || path.endsWith(`.${form}`)) ? 20 : 0) +
          (forms.some((form) => path.includes(form)) ? 8 : 0) +
          (forms.some((form) => description.includes(form)) ? 4 : 0) +
          (forms.some((form) => candidate.searchText.includes(form)) ? 2 : 0),
        0,
      )
      return { candidate, score }
    })
    .filter(({ score }) => terms.length === 0 || score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.path.localeCompare(right.candidate.path))
    .map(({ candidate }) => candidate)
}
