import fuzzysort from "fuzzysort"
import { ModelPresentation } from "@opencode/schema/model-presentation"
import { matchesModelSearch } from "./search"

type Ref = { providerID: string; modelID: string }

export type ModelOptionBase = {
  key: string
  value: Ref
  title: string
  providerID: string
  providerName: string
  /** The connection and router hops, the section a model is listed under. */
  category: string
  description: string
  releaseDate: string | number
  footer?: "Free"
}

export type ModelSection<T> = {
  key: string
  kind: "results" | "favorites" | "recent" | "route"
  /** The route a `route` section lists. */
  category?: string
  items: T[]
}

/**
 * The picker's sections, as the TUI's model dialog builds them. A search lists one flat result,
 * favorites first, then free and newest models; whole-word matches win and fuzzy matching only fills in
 * when nothing contains the query. Without a search: Favorites, Recent (without favorites), then every
 * other model grouped by connection and route. A picker for one provider skips Favorites and Recent.
 */
export function modelSections<T extends ModelOptionBase>(
  options: readonly T[],
  input: { search: string; favorites: readonly Ref[]; recent: readonly Ref[]; provider?: string },
): ModelSection<T>[] {
  const needle = input.search.trim()

  if (needle) {
    const exact = options.filter((option) =>
      matchesModelSearch(needle, [option.title, option.value.modelID, option.providerName, option.description]),
    )
    const found = exact.length
      ? exact
      : fuzzysort.go(needle, options, { keys: ["title", "category", "description"] }).map((result) => result.obj)

    return [
      {
        key: "results",
        kind: "results",
        items: ModelPresentation.prioritizeFavorites(
          ModelPresentation.sortModelOptions([...found], false),
          new Set(input.favorites.map(ModelPresentation.preferenceKey)),
        ),
      },
    ]
  }

  const byKey = new Map(options.map((option) => [ModelPresentation.preferenceKey(option.value), option]))
  const pick = (refs: readonly Ref[]) => refs.flatMap((ref) => byKey.get(ModelPresentation.preferenceKey(ref)) ?? [])
  const favorites = input.provider ? [] : pick(input.favorites)
  const recent = input.provider ? [] : pick(input.recent).filter((option) => !favorites.includes(option))
  const listed = new Set([...favorites, ...recent])
  const routes = ModelPresentation.sortModelOptions(options.filter((option) => !listed.has(option))).reduce(
    (groups, option) => groups.set(option.category, [...(groups.get(option.category) ?? []), option]),
    new Map<string, T[]>(),
  )

  return [
    ...(favorites.length ? [{ key: "favorites", kind: "favorites" as const, items: favorites }] : []),
    ...(recent.length ? [{ key: "recent", kind: "recent" as const, items: recent }] : []),
    ...Array.from(routes, ([category, items]) => ({
      key: `route:${category}`,
      kind: "route" as const,
      category,
      items,
    })),
  ]
}
