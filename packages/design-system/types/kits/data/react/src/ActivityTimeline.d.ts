import type { ActivityTimelineContract } from "../../src/core/contracts/activitytimeline";
export type { ActivityTimelineEvent, ActivityTimelineRow } from "../../src/activity-timeline";
export interface ActivityTimelineProps extends ActivityTimelineContract {
    /** Called when the person retries after a failed load. */
    onretry?: () => void;
    /** Additional outer classes. */
    className?: string;
}
export declare function ActivityTimeline({ label, rows, domain, formatTime, endLabel, state, errorMessage, retryLabel, loadingRows, onretry, className }: ActivityTimelineProps): import("react").JSX.Element;
export default ActivityTimeline;
