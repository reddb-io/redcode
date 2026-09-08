export * as DesignSystem from "./system"

import path from "node:path"
import { DesignFiles } from "./files"

/** File hashes are provenance, not a claim that inferred tokens are authoritative. */
export async function discover(application: string) {
  // Bun's glob scanner cannot expand a brace containing both root files and recursive paths.
  const paths = (
    await Promise.all(
      [
        "{DESIGN.md,design-system.md,tailwind.config.*,components.json}",
        "src/**/{tokens.css,tokens.ts,tokens.json,theme.css,theme.ts,global.css,globals.css}",
      ].map((pattern) =>
        Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: application, onlyFiles: true, followSymlinks: false })),
      ),
    )
  )
    .flat()
    .map((file) => file.split(path.sep).join("/"))
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
