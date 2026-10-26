import type { ChartCurve, SparklineVariant } from "../../src/chart";
interface SparklinePlotProps {
    strokeWidth?: number;
    data: readonly {
        x: number;
        y: number;
    }[];
    curve: ChartCurve;
    variant: SparklineVariant;
    width: number;
    height: number;
}
/** This optional drawing chunk is requested only when its figure is wanted. */
export default function SparklinePlot({ strokeWidth, data, curve, variant, width, height, }: SparklinePlotProps): import("react").JSX.Element;
export {};
