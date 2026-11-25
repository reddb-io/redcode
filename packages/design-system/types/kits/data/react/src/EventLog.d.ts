import type { EventLogContract } from "../../src/core/contracts/eventlog";
export type { LogEvent } from "../../src/operational";
export interface EventLogProps extends EventLogContract {
    /** Called when the person retries after a failed load. */
    onretry?: () => void;
    /** Additional root classes. */
    className?: string;
}
export declare function EventLog({ label, events, limit, query, following, onfollowingchange, emptyLabel, state, errorMessage, retryLabel, loadingRows, onretry, className, }: EventLogProps): import("react").JSX.Element;
export default EventLog;
