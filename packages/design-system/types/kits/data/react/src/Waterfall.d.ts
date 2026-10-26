export type { VisualizationSize, VisualizationSeries, } from "../../src/visualization";
export type { WaterfallStep } from "../../src/waterfall";
import type { WaterfallContract } from "../../src/core/contracts/waterfall";
export interface WaterfallProps extends WaterfallContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function Waterfall(props: WaterfallProps): import("react").JSX.Element;
export default Waterfall;
