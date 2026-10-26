export type { ScheduleMarker, ScheduleWindow } from "../../src/core/schedule-overlays";
export type { TimeInterval } from "../../src/intervals";
export type { VisualizationSize } from "../../src/visualization";
import type { GanttContract } from "../../src/core/contracts/gantt";
export interface GanttProps extends GanttContract {
    /** Reports expanded or collapsed hierarchy state. */
    onCollapsedChange?: (ids: readonly string[]) => void;
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function Gantt(props: GanttProps): import("react").JSX.Element;
export default Gantt;
