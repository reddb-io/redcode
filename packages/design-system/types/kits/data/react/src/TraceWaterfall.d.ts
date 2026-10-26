export type { TimeInterval } from "../../src/intervals";
export type { VisualizationSize } from "../../src/visualization";
import type { TraceWaterfallContract } from "../../src/core/contracts/tracewaterfall";
export interface TraceWaterfallProps extends TraceWaterfallContract {
    /** Reports expanded or collapsed hierarchy state. */
    onCollapsedChange?: (ids: readonly string[]) => void;
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function TraceWaterfall(props: TraceWaterfallProps): import("react").JSX.Element;
export default TraceWaterfall;
