import type { Tone } from "@reddb-io/design-system/base";
export declare const TASK_STATES: readonly ["queued", "running", "paused", "blocked", "succeeded", "failed", "cancelled"];
export type TaskState = (typeof TASK_STATES)[number];
export interface TaskListItem {
    /** Stable identity across updates, filtering and ordering. */
    id: string;
    /** Visible task name, used to name its progress. */
    title: string;
    /** Caller-owned lifecycle state; the list never starts or schedules work. */
    state: TaskState;
    /** Localized state name; defaults to the English lifecycle name. */
    stateLabel?: string;
    /** Optional semantic emphasis; otherwise follows the lifecycle state. */
    tone?: Tone;
    /** Supporting task context. */
    description?: string;
    /** Progress from 0 to 100, clamped by Progress; null means indeterminate. Omit to hide the track. */
    progress?: number | null;
    /** Caller-formatted progress reading, if different from a percentage. */
    progressLabel?: string;
    /** Worker or other execution context, already formatted by the caller. */
    worker?: string;
    /** Caller-formatted remaining-time estimate; no timers run in the component. */
    estimate?: string;
    /** Visible reason for a blocked, paused or failed task, or other relevant explanation. */
    reason?: string;
    /** Optional destination for the task name. */
    href?: string;
}
export declare const TASK_STATE_LABELS: Record<TaskState, string>;
export declare const TASK_STATE_TONES: Record<TaskState, Tone>;
export declare function validateTasks(items: readonly TaskListItem[]): readonly TaskListItem[];
