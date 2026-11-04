import type { EventSeriesExplorerContract } from "../../src/core/contracts/eventseriesexplorer";
export interface EventSeriesExplorerProps extends EventSeriesExplorerContract {
    /** Extra root classes. */
    className?: string;
}
export declare function EventSeriesExplorer({ label, series, context, emptyLabel, className, }: EventSeriesExplorerProps): import("react").JSX.Element;
export default EventSeriesExplorer;
