/** Clamp caller-owned remaining time to whole, non-negative seconds. */
export declare function normalizeRemaining(remaining: number): number;
/** A compact clock rendering that keeps hours when a duration crosses one hour. */
export declare function formatDuration(remaining: number): string;
/** The same normalized duration in the machine-readable form native `<time>` expects. */
export declare function durationAttribute(remaining: number): string;
