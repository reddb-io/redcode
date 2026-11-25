/** Where one step of an agent's work stands (ADR 0059). */
export declare const TOOL_STEP_STATUSES: readonly ["running", "succeeded", "failed", "cancelled"];
export type ToolStepStatus = (typeof TOOL_STEP_STATUSES)[number];
/** One step of an agent's work: a command run, a file edited, a search made. */
export interface ToolStep {
    /** Stable identity. */
    id: string;
    /** What the step is, in the caller's words (`command`, `edit`, `search`); shown before the label. */
    kind?: string;
    /** What the step did, e.g. `pnpm test`. */
    label: string;
    /** Where the step stands. */
    status: ToolStepStatus;
}
/** Portable ToolActivity properties shared by native adapters (ADR 0059). */
export interface ToolActivityContract {
    /** Caller-localised summary of the work, e.g. "Ran 4 commands, edited 2 files". */
    summary: string;
    /** The steps, in order. */
    steps: readonly ToolStep[];
    /** Whether the steps are shown. Defaults to closed. */
    open?: boolean;
    /** Visible words for each status, for localisation. */
    statusLabels?: Partial<Record<ToolStepStatus, string>>;
}
export declare const TOOL_STEP_STATUS_LABELS: Readonly<Record<ToolStepStatus, string>>;
/** The summary's live state: running while any step runs, failed when any failed. */
export declare function toolActivityState(steps: readonly ToolStep[]): "running" | "failed" | "done";
