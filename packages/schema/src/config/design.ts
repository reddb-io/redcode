export * as ConfigDesign from "./design.js"

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
      "Project-relative directory of the application package the design system belongs to, such as apps/web in a monorepo. design_document create uses it when no application is named; system paths are relative to it. It is read together with system from the same configuration document: a document that sets system without application drops an application set elsewhere, and an application set without system is ignored while another document supplies system.",
  }),
  browser: Schema.String.pipe(Schema.optional).annotate({
    description:
      'Browser that opens Design review pages: "default" for the system browser, "chrome" or "chromium" for that installed browser, "app" for a Chrome or Chromium app window (--app), an app name, or an executable path. Equivalent to REDCODE_DESIGN_BROWSER, which wins when both are set. Default: Chrome or Chromium when installed, else the system browser.',
  }),
  breakpoints: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 240, maximum: 3840 })))
    .check(Schema.isMinLength(1), Schema.isMaxLength(6))
    .pipe(Schema.optional)
    .annotate({
      description:
        "Viewport widths in CSS pixels that web designs are reviewed and audited at, narrowest first. Default: [390, 768, 1440]. App designs use phone presets and presentations 1920×1080 instead.",
    }),
  viewports: Schema.Array(Schema.String)
    .pipe(Schema.optional)
    .annotate({
      description:
        'Viewport classes the layout audit covers: "mobile" (up to 640px), "compact" (up to 1024px) and "desktop". Default: every class the target is reviewed at. Unknown names are ignored, and a list naming no known class, or leaving the target without a viewport, keeps every class.',
    }),
  gate: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "Require a completed layout audit of the published revision at every viewport class in design.viewports before a Design can be approved. Default: false.",
  }),
  app: Schema.Struct({
    mode: Schema.Literals(["process", "inline"]).pipe(Schema.optional).annotate({
      description:
        'Where Design builds, renders, exports and serves its review when redcode runs from source: "process" runs them in the design app (redcode-design), a separate process redcode starts on demand and that exits after ten idle minutes; "inline" runs them inside redcode. Default: "inline". Installed redcode always uses the design app and ignores this setting.',
    }),
    version: Schema.String.check(Schema.isPattern(/^(latest|\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/))
      .pipe(Schema.optional)
      .annotate({
        description:
          'Design app release to run: an exact version such as "0.1.0", or "latest" for the newest release that speaks this redcode\'s protocol. Default: the release this redcode was built with. Releases are downloaded from GitHub on first use into the cache directory and verified against their SHA256SUMS; REDCODE_DESIGN_BIN overrides the binary.',
      }),
  })
    .pipe(Schema.optional)
    .annotate({ description: "The design app process that serves Design's review surface and runs its heavy work" }),
}) {}

/** The `design` section in effect: what the layered configuration documents say together. */
export interface Effective {
  readonly system?: System
  readonly application?: string
  readonly browser?: string
  readonly breakpoints?: readonly number[]
  readonly viewports?: readonly string[]
  readonly gate?: boolean
  readonly app?: Info["app"]
}

/**
 * Merges `design` sections from lowest to highest precedence, key by key, as the legacy
 * configuration does with its deep merge: `browser`, `breakpoints`, `viewports` and `gate` come from the most specific
 * document that sets them, and `system` from the most specific one that sets it, together with that document's
 * `application` (paths are relative to it). A project that declares its system therefore keeps a
 * global `browser` and `app` settings.
 */
export function merge<S>(
  sections: readonly (
    | {
        readonly system?: S
        readonly application?: string
        readonly browser?: string
        readonly breakpoints?: readonly number[]
        readonly viewports?: readonly string[]
        readonly gate?: boolean
        readonly app?: Info["app"]
      }
    | undefined
  )[],
) {
  const system = sections.findLast((section) => section?.system !== undefined)
  const application = system ? system.application : sections.findLast((section) => section?.application)?.application
  const browser = sections.findLast((section) => section?.browser !== undefined)?.browser
  const breakpoints = sections.findLast((section) => section?.breakpoints !== undefined)?.breakpoints
  const viewports = sections.findLast((section) => section?.viewports !== undefined)?.viewports
  const gate = sections.findLast((section) => section?.gate !== undefined)?.gate
  const app = sections.reduce(
    (current, section) => section?.app === undefined ? current : { ...current, ...section.app },
    undefined as Info["app"],
  )
  if (
    !system &&
    application === undefined &&
    browser === undefined &&
    breakpoints === undefined &&
    viewports === undefined &&
    gate === undefined &&
    app === undefined
  )
    return undefined
  return {
    ...(system ? { system: system.system as S } : {}),
    ...(application !== undefined ? { application } : {}),
    ...(browser !== undefined ? { browser } : {}),
    ...(breakpoints !== undefined ? { breakpoints } : {}),
    ...(viewports !== undefined ? { viewports } : {}),
    ...(gate !== undefined ? { gate } : {}),
    ...(app !== undefined ? { app } : {}),
  }
}
