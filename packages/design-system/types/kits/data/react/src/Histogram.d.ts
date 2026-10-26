export * from "../../src/core/histogram";
import type { HistogramContract } from "../../src/core/contracts/histogram";
export interface HistogramProps extends HistogramContract {
    /** Extra classes, merged onto the chart's root `figure`. */
    className?: string;
}
export declare function Histogram(props: HistogramProps): import("react").JSX.Element;
export default Histogram;
