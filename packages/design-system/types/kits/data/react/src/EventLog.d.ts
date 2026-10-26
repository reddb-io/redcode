import type { EventLogContract } from "../../src/core/contracts/eventlog";
export type { LogEvent } from "../../src/operational";
export interface EventLogProps extends EventLogContract {
    /** Additional root classes. */
    className?: string;
}
export declare function EventLog({ label, events, limit, query, following, onfollowingchange, emptyLabel, className, }: EventLogProps): import("react").JSX.Element;
export default EventLog;
