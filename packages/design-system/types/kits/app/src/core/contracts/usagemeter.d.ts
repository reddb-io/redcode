/** A part of the usage, e.g. input and output tokens. */
export interface UsageSegment {
    /** Stable identity. */
    id: string;
    /** Visible name. */
    label: string;
    /** Amount in the meter's unit. */
    value: number;
}
/** Portable UsageMeter properties shared by native adapters (ADR 0059). */
export interface UsageMeterContract {
    /** Accessible and visible name, e.g. "Context window". */
    label: string;
    /** Amount used. */
    used: number;
    /** Amount available. */
    limit: number;
    /** Unit of the amounts, e.g. "tokens". */
    unit: string;
    /** Optional breakdown of `used`. */
    segments?: readonly UsageSegment[];
    /** Fractions of the limit where the meter turns warning and danger. Defaults to 0.75 and 0.9. */
    thresholds?: {
        warning: number;
        danger: number;
    };
    /** Formats an amount; defaults to the locale's grouping. */
    format?: (value: number) => string;
}
/** The meter's tone for a share of the limit. */
export declare function usageTone(used: number, limit: number, thresholds?: {
    warning: number;
    danger: number;
}): "neutral" | "warning" | "danger";
