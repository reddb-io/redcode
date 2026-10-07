export * as DesignReferences from "./references.js"

import { Design } from "@opencode/schema/design"
import { DesignFiles } from "./files.js"
import { DesignStyles } from "./styles.js"

export interface Reference {
  readonly file: string
  readonly hash: string
  readonly tokens: readonly { readonly name: string; readonly line: number }[]
  readonly components: readonly string[]
}

/** Names from the observed CSS excerpt, not a claim that discovery is an exhaustive or authoritative token registry. */
export function tokens(sources: readonly (typeof Design.Source.Type)[]) {
  return sources
    .filter((source) => source.file.endsWith(".css"))
    .flatMap((source) => {
      const line = DesignStyles.positions(source.excerpt)
      return DesignStyles.declarations(source.excerpt)
        .filter((entry) => entry.property.startsWith("--"))
        .map((entry) => ({
          name: entry.property,
          value: entry.value,
          file: source.file,
          hash: source.hash,
          line: line(entry.offset),
        }))
    })
}

/** Component files are read without evaluation, within the same per-file size bound as their inventory. */
export async function collect(
  application: string,
  sources: readonly (typeof Design.Source.Type)[],
  inventory: readonly Design.Component[],
): Promise<Reference[]> {
  const observed = tokens(sources)
  const components = await Promise.all(
    [...Map.groupBy(inventory, (entry) => entry.file)].map(async ([file, entries]) => {
      const resolved = await DesignFiles.resolve(application, file).catch(() => undefined)
      if (!resolved) return []
      const source = Bun.file(resolved)
      if (!(await source.exists()) || source.size > 256 * 1024) return []
      return [
        {
          file,
          hash: DesignFiles.hash(await source.bytes()),
          tokens: [],
          components: entries.map((entry) => entry.name),
        },
      ]
    }),
  )
  return [
    ...[...Map.groupBy(observed, (entry) => entry.file)].map(([file, entries]) => ({
      file,
      hash: entries[0]!.hash,
      tokens: entries
        .filter((entry, index) => entries.findIndex((other) => other.name === entry.name) === index)
        .slice(0, 100)
        .map((entry) => ({ name: entry.name, line: entry.line })),
      components: [],
    })),
    ...components.flat(),
  ].toSorted((a, b) => a.file.localeCompare(b.file))
}
