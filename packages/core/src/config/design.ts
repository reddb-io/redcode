export * as ConfigDesign from "./design"

import { Schema } from "effect"

export const Framework = Schema.Literals(["react", "solid"])
export type Framework = typeof Framework.Type

export class System extends Schema.Class<System>("ConfigV2.Design.System")({
  paths: Schema.Array(Schema.String).annotate({
    description:
      'Project-relative component and token roots of the design system. Declaring a root is a standing read grant for design builds: design_preview asks once for the declared roots and stylesheets, the tooling configuration and the project\'s node_modules, and later preview builds import from them without a per-file prompt. Symlinks escaping a declared root are still refused, and a package linked to a source tree outside node_modules (a workspace package) must be declared here; "." grants the whole project.',
  }),
  css: Schema.Array(Schema.String).pipe(Schema.optional).annotate({
    description:
      "Project-relative stylesheets included in every preview. The html engine links a built copy; react and solid entries import them before the prototype's own code.",
  }),
  tailwind: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "Run the project's PostCSS pipeline (postcss.config.*, or tailwindcss with autoprefixer synthesized from tailwind.config.*) in preview builds so Tailwind utilities used by the prototype are generated. This executes those configuration files in the redcode process, so design_preview asks a separate project_tooling permission naming them; when it is refused the preview builds without the pipeline. Default: enabled when tailwind.config.* exists and tailwindcss is a dependency. Tailwind v4 needs an explicit true.",
  }),
  framework: Framework.pipe(Schema.optional).annotate({
    description: "Component framework of the declared roots. Default: detected from package.json dependencies.",
  }),
  aliases: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional).annotate({
    description:
      "Extra import aliases for preview builds, mapping an import prefix to a project-relative directory, applied on top of the tsconfig paths.",
  }),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Design")({
  system: System.pipe(Schema.optional).annotate({
    description: "The project's design system that previews reuse: component roots, stylesheets and CSS pipeline",
  }),
  application: Schema.String.pipe(Schema.optional).annotate({
    description:
      "Project-relative directory of the application package the design system belongs to, such as apps/web in a monorepo. design_document create uses it when no application is named; system paths are relative to it.",
  }),
  browser: Schema.String.pipe(Schema.optional).annotate({
    description:
      'Browser that opens Design review pages: "default" for the system browser, an app name, or an executable path. Equivalent to REDCODE_DESIGN_BROWSER, which wins when both are set. Default: Chrome or Chromium when installed, else the system browser.',
  }),
}) {}

/** The `design` section in effect: what the layered configuration documents say together. */
export interface Effective {
  readonly system?: System
  readonly application?: string
  readonly browser?: string
}

/**
 * Merges `design` sections from lowest to highest precedence, key by key, as the legacy
 * configuration does with its deep merge: `browser` comes from the most specific document that
 * sets it, and `system` from the most specific one that sets it, together with that document's
 * `application` (paths are relative to it). A project that declares its system therefore keeps a
 * global `browser`.
 */
export function merge<S>(
  sections: readonly ({ readonly system?: S; readonly application?: string; readonly browser?: string } | undefined)[],
) {
  const system = sections.findLast((section) => section?.system !== undefined)
  const application = system ? system.application : sections.findLast((section) => section?.application)?.application
  const browser = sections.findLast((section) => section?.browser !== undefined)?.browser
  if (!system && application === undefined && browser === undefined) return undefined
  return {
    ...(system ? { system: system.system as S } : {}),
    ...(application !== undefined ? { application } : {}),
    ...(browser !== undefined ? { browser } : {}),
  }
}
