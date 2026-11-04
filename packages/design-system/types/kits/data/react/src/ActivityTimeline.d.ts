import { type ActivityTimelineRow } from "../../src/activity-timeline";
export type { ActivityTimelineEvent, ActivityTimelineRow } from "../../src/activity-timeline";
export interface ActivityTimelineProps {
    /** Accessible title for the timeline. */
    label: string;
    /** Activities and their child event intervals. */
    rows: readonly ActivityTimelineRow[];
    /** Optional finite, increasing time bounds. */
    domain?: readonly [number, number];
    /** Formats exact event times in the accessible list. */
    formatTime?: (value: number) => string;
    /** Visible text for the scroll control. */
    endLabel?: string;
    /** Additional outer classes. */
    className?: string;
}
export declare function ActivityTimeline({ label, rows, domain, formatTime, endLabel, className }: ActivityTimelineProps): import("react").JSX.Element;
export default ActivityTimeline;
