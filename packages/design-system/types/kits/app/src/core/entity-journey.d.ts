/** Caller-observed execution state; selection never advances the journey. */
export type JourneyState = "complete" | "current" | "upcoming" | "blocked" | "failed" | "skipped";
export interface JourneyStage {
    /** Stable identity shared with an inspector or scene. */
    id: string;
    /** Visible stage name. */
    label: string;
    /** Explicit observed state, never inferred from position or elapsed time. */
    state: JourneyState;
    /** Optional supporting observation. */
    description?: string;
    /** Caller-formatted elapsed duration or timestamp. */
    elapsed?: string;
    /** Localized state label; omitted, uses the English state name. */
    stateLabel?: string;
}
export declare function journeyStages(items: readonly JourneyStage[]): {
    tone: "neutral" | "info" | "success" | "warning" | "danger";
    stateLabel: string;
    /** Stable identity shared with an inspector or scene. */
    id: string;
    /** Visible stage name. */
    label: string;
    /** Explicit observed state, never inferred from position or elapsed time. */
    state: JourneyState;
    /** Optional supporting observation. */
    description?: string;
    /** Caller-formatted elapsed duration or timestamp. */
    elapsed?: string;
}[];
