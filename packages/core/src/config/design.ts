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
}) {}
