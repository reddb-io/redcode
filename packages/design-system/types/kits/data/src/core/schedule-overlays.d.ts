import type { Tone } from "@reddb-io/design-system/base";
export interface ScheduleMarker {
    /** Stable marker identity. */
    id: string;
    /** Visible and accessible marker label, such as Deadline or Now. */
    label: string;
    /** Position in the same caller-owned time unit as the intervals. */
    time: number;
    /** Semantic emphasis; no clock or deadline inference is performed. */
    tone?: Tone;
}
export interface ScheduleWindow {
    /** Stable window identity. */
    id: string;
    /** Visible reason for the unavailable period. */
    label: string;
    /** Inclusive beginning in the intervals' time unit. */
    start: number;
    /** End in the intervals' time unit; must follow start. */
    end: number;
    /** Optional interval row; omitted, shades the entire plot. */
    intervalId?: string;
}
export interface ScheduleOverlays {
    /** Caller-owned deadline, now or reference markers; no timer runs in the component. */
    markers?: readonly ScheduleMarker[];
    /** Caller-owned unavailability windows; the component never reschedules intervals. */
    windows?: readonly ScheduleWindow[];
    /** Shows the built-in selected-interval details; false supports an external linked inspector. */
    showDetails?: boolean;
}
export declare function scheduleOverlays(markers: readonly ScheduleMarker[], windows: readonly ScheduleWindow[], intervalIds: readonly string[]): {
    markers: readonly ScheduleMarker[];
    windows: readonly ScheduleWindow[];
};
export declare function clippedWindow(start: number, end: number, domain: readonly [number, number]): readonly [number, number] | null;
export declare function markerPaint(tone?: Tone): string;
