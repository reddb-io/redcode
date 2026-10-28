import { Effect, Option, Predicate, Schema, SchemaGetter } from "effect"
import { timelinePresets, type TimelineCategory } from "@opencode/session-ui/timeline/detail"
import { Persistence } from "@/runtime/persistence/schema"

export type Settings = typeof settingsSchema.Type

export type WorkspaceDefaultDestination = Settings["workspaces"]["defaultDestination"]

export type WorkspaceLastUsed = Settings["workspaces"]["lastUsed"][string]

export type TerminalPlacement = Settings["general"]["terminalPlacement"]

export type FollowUpBehavior = Settings["general"]["followUpBehavior"]
export type TimelineWidth = "comfortable" | "wide" | "full"
export type NotificationSettings = Settings["notifications"]

export type SoundSettings = Settings["sounds"]
export type AppearanceDensity = Settings["appearance"]["density"]

export const monoDefault = "JetBrains Mono"
export const sansDefault = "Space Grotesk"
export const terminalDefault = "JetBrainsMono Nerd Font Mono"
// The design system's own stacks, which already end in a metric-matched fallback for the Brand face.
const monoFallback = "var(--reddb-font-family-mono)"
const sansFallback = "var(--reddb-font-family-sans)"
const terminalFallback =
  '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const monoBase = monoFallback

const sansBase = sansFallback

const terminalBase = terminalFallback

function input(font: string | undefined) {
  return font ?? ""
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font

  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string) {
  const value = font?.trim() ?? ""

  if (!value) return base

  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

export function terminalInput(font: string | undefined) {
  return input(font)
}

export function terminalFontFamily(font: string | undefined) {
  return stack(font, terminalBase)
}

const placementSchema = Schema.Literals(["separate", "grouped", "hidden"])

const detailsSchema = Schema.Literals(["collapsed", "expanded"])

const activitySchema = Persistence.struct({ placement: placementSchema, details: detailsSchema })

const placementOnlySchema = Persistence.struct({ placement: placementSchema })

const generalSchema = Persistence.struct({
  // Retired preferences without readers; kept so stored values still decode and round-trip.
  autoSave: Persistence.optional(Schema.Boolean),
  // Owned by the updater extension, which copies it out once; kept so settings rewrites cannot drop it first.
  releaseNotes: Persistence.optional(Schema.Boolean),
  showFileTree: Schema.Boolean,
  showNavigation: Persistence.optional(Schema.Boolean),
  // Retired label-visibility preference; retain saved values when rewriting settings.
  navigationLabels: Persistence.optional(Schema.Boolean),
  navigationGap: Persistence.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 16 }))),
  showSearch: Persistence.optional(Schema.Boolean),
  showTerminal: Persistence.optional(Schema.Boolean),
  timelineWidth: Persistence.optional(Schema.Literals(["comfortable", "wide", "full"])),
  timelineDetail: Persistence.struct({
    shell: activitySchema,
    edit: activitySchema,
    thinking: activitySchema,
    subagents: placementOnlySchema,
    notices: placementOnlySchema,
    tools: placementOnlySchema,
  }),
  // Replaces `showCustomAgents`, which hid the agent picker by default and was written back as `false` with every
  // other setting. Its stored value records no choice, so it is dropped rather than migrated.
  showAgent: Schema.Boolean,
  mobileTitlebarPosition: Schema.Literals(["top", "bottom"]),
  // Owned by the review extension, which copies it out once; kept so settings rewrites cannot drop it first.
  mobileDiffWrap: Persistence.optional(Schema.Boolean),
  terminalPlacement: Schema.Literals(["side", "bottom"]),
  followUpBehavior: Schema.Literals(["queue", "steer"]),
})

const appearanceSchema = Persistence.struct({
  density: Schema.Literals(["tiny", "compact", "comfortable"]),
  fontSize: Schema.Number,
  mono: Schema.String,
  sans: Schema.String,
  terminal: Schema.String,
})

const permissionsSchema = Persistence.struct({
  autoApprove: Schema.Boolean,
})

const workspacesSchema = Persistence.struct({
  defaultDestination: Schema.Literals(["last-used", "local", "new"]),
  lastUsed: Persistence.record(
    Schema.Literals(["local", "workspace"]).pipe(Schema.catchDecoding(() => Effect.succeed(Option.none()))),
  ),
})

const notificationsSchema = Persistence.struct({
  agent: Schema.Boolean,
  permissions: Schema.Boolean,
  errors: Schema.Boolean,
})

const soundsSchema = Persistence.struct({
  agentEnabled: Schema.Boolean,
  agent: Schema.String,
  permissionsEnabled: Schema.Boolean,
  permissions: Schema.String,
  errorsEnabled: Schema.Boolean,
  errors: Schema.String,
})

export const settingsSchema = Persistence.struct({
  voiceDevice: Persistence.optional(Schema.String),
  general: generalSchema,
  // Owned by the details extension, which copies it out once; kept so settings rewrites cannot drop it first.
  sessionSummary: Schema.optional(
    Persistence.struct({ projectExpanded: Schema.Boolean, serverExpanded: Schema.Boolean }),
  ),
  appearance: appearanceSchema,
  keybinds: Persistence.record(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))),
  permissions: permissionsSchema,
  workspaces: workspacesSchema,
  notifications: notificationsSchema,
  sounds: soundsSchema,
})

function storedTimelineCategory(category: TimelineCategory) {
  return Persistence.optional(
    Schema.Union([
      Schema.Struct({
        placement: Persistence.optional(placementSchema),
        details: Persistence.optional(detailsSchema),
      }),
      Schema.Literals(["expanded", "collapsed", "hidden", "visible"]),
    ]).pipe(
      Schema.decode({
        decode: SchemaGetter.transform((value) => {
          if (!Predicate.isString(value)) return value

          return {
            placement:
              value === "hidden"
                ? "hidden"
                : category === "subagents"
                  ? "separate"
                  : category === "tools"
                    ? "grouped"
                    : value === "expanded"
                      ? "separate"
                      : value === "collapsed"
                        ? "grouped"
                        : undefined,
            details: value === "expanded" ? "expanded" : "collapsed",
          }
        }),
        encode: SchemaGetter.passthrough(),
      }),
    ),
  )
}

function legacyTimelineActivity(value: boolean | "hidden" | "compact" | "full" | null | undefined) {
  if (value === undefined || value === null) return
  const expanded = value === true || value === "full"

  return {
    placement: value === "hidden" ? "hidden" : expanded ? "separate" : "grouped",
    details: expanded ? "expanded" : "collapsed",
  } as const
}

export const settingsPersistence = Persistence.migrate(
  settingsSchema,
  Schema.Struct({
    general: Persistence.optional(
      Schema.Struct({
        // Keep invalid explicit values distinct from absent values so legacy preferences cannot replace them.
        timelineDetail: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              shell: storedTimelineCategory("shell"),
              edit: storedTimelineCategory("edit"),
              thinking: storedTimelineCategory("thinking"),
              subagents: storedTimelineCategory("subagents"),
              notices: storedTimelineCategory("notices"),
              tools: storedTimelineCategory("tools"),
            }),
          ),
        ).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(null)))),
        reasoningMode: Schema.optional(Schema.NullOr(Schema.Literals(["hidden", "compact", "full"]))).pipe(
          Schema.catchDecoding(() => Effect.succeed(Option.some(null))),
        ),
        showReasoningSummaries: Persistence.optional(Schema.Boolean),
        shellToolPartsExpanded: Persistence.optional(Schema.Boolean),
        editToolPartsExpanded: Persistence.optional(Schema.Boolean),
      }),
    ),
  }).pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => {
        const general = value.general

        if (!general || general.timelineDetail !== undefined) return value

        return {
          ...value,
          general: {
            ...general,
            timelineDetail: {
              shell: legacyTimelineActivity(general.shellToolPartsExpanded),
              edit: legacyTimelineActivity(general.editToolPartsExpanded),
              thinking: legacyTimelineActivity(
                general.reasoningMode === undefined ? general.showReasoningSummaries : general.reasoningMode,
              ),
            },
          },
        }
      }),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
)

export const defaultSettings: Settings = {
  general: {
    showFileTree: false,
    showNavigation: true,
    navigationLabels: true,
    navigationGap: 12,
    timelineDetail: { ...timelinePresets[2].value },
    showAgent: true,
    mobileTitlebarPosition: "top",
    terminalPlacement: "side",
    followUpBehavior: "steer",
  },
  // The retired `tabLayout: "vertical"` decodes away: the rail's sidemenu, open by default, replaced it.
  appearance: { density: "tiny", fontSize: 14, mono: "", sans: "", terminal: "" },
  keybinds: {},
  permissions: { autoApprove: false },
  workspaces: { defaultDestination: "last-used", lastUsed: {} },
  notifications: { agent: true, permissions: true, errors: false },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
}
