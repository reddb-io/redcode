export * as DesignSystem from "./system"

import path from "node:path"
import { DesignFiles } from "./files"

/** File hashes are provenance, not a claim that inferred tokens are authoritative. */
export async function discover(application: string) {
  const matches = new Bun.Glob(
    "{DESIGN.md,design-system.md,src/**/tokens.{css,ts,json},src/**/theme.{css,ts},src/**/global.css,src/**/globals.css,tailwind.config.*,components.json}",
  )
  const paths = (await Array.fromAsync(matches.scan({ cwd: application, onlyFiles: true, followSymlinks: false })))
    .sort()
    .slice(0, 30)
  return Promise.all(
    paths.map(async (file) => {
      const bytes = await Bun.file(await DesignFiles.resolve(application, file)).bytes()
      return {
        file,
        hash: DesignFiles.hash(bytes),
        observed: Date.now(),
        authoritative: /(?:DESIGN|design-system)\.md$/.test(path.basename(file)),
        excerpt: new TextDecoder().decode(bytes.subarray(0, 12000)),
      }
    }),
  )
}
