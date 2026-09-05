import path from "path"
import { Schema } from "effect"
import { DesignKinds } from "./kinds"

/**
 * What the prototype is, and why it is that.
 *
 * A prototype on its own is a file: someone reading it later sees what was decided and none of the
 * reasoning. The manifest is the half that survives into the plan — what the conversation settled,
 * and what it did not.
 */
export const Manifest = Schema.Struct({
  /** Schema version, so a manifest written by an older build still reads. */
  version: Schema.Literal(1),
  name: Schema.String,
  /** What kind of thing this is: a screen, a flow, a comparison, a deck. */
  kind: Schema.Literals(DesignKinds.KINDS),
  /** Relative to the design directory. */
  entry: Schema.String,
  /** What the conversation settled, in the words it settled them. */
  decisions: Schema.Array(Schema.String),
  /** What it did not settle. These become the open questions of the plan. */
  questions: Schema.Array(Schema.String),
  /** Set once the design becomes a plan, so each points at the other. */
  plan: Schema.optional(Schema.String),
  /** Where the session left it: the last revision a turn ended on. Bookkeeping, never prompted. */
  state: Schema.optional(Schema.Struct({ revision: Schema.Number, updated: Schema.Number })),
})
export type Manifest = Schema.Schema.Type<typeof Manifest>

export const FILE = "design.json"

export const file = (root: string) => path.join(root, FILE)

export function empty(name: string): Manifest {
  return { version: 1, name, kind: DesignKinds.DEFAULT, entry: "index.html", decisions: [], questions: [] }
}

/**
 * Read a manifest, or start one.
 *
 * A missing or unreadable manifest is not a failure: the prototype is the thing that matters, and
 * losing the notes should never stop a design session. It starts a fresh one instead.
 */
export function parse(raw: string, name: string): Manifest {
  try {
    const decoded = JSON.parse(raw) as Partial<Manifest>
    if (decoded?.version !== 1) return empty(name)
    return {
      version: 1,
      name: typeof decoded.name === "string" && decoded.name ? decoded.name : name,
      kind: DesignKinds.isKind(decoded.kind) ? decoded.kind : DesignKinds.DEFAULT,
      entry: typeof decoded.entry === "string" && decoded.entry ? decoded.entry : "index.html",
      decisions: Array.isArray(decoded.decisions) ? decoded.decisions.filter((x) => typeof x === "string") : [],
      questions: Array.isArray(decoded.questions) ? decoded.questions.filter((x) => typeof x === "string") : [],
      ...(typeof decoded.plan === "string" ? { plan: decoded.plan } : {}),
      ...(typeof decoded.state?.revision === "number" && typeof decoded.state?.updated === "number"
        ? { state: { revision: decoded.state.revision, updated: decoded.state.updated } }
        : {}),
    }
  } catch {
    return empty(name)
  }
}

export const serialize = (manifest: Manifest) => JSON.stringify(manifest, null, 2) + "\n"

/** What the plan inherits from the design: the reasoning, not the markup. */
export function summarize(manifest: Manifest, prototype: string) {
  const lines = [`Prototype: ${prototype} (${manifest.kind})`]
  if (manifest.decisions.length) {
    lines.push("", "Decided:", ...manifest.decisions.map((item) => `- ${item}`))
  }
  if (manifest.questions.length) {
    lines.push("", "Still open:", ...manifest.questions.map((item) => `- ${item}`))
  }
  return lines.join("\n")
}

export * as DesignManifest from "./manifest"
