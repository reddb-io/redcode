import type { CompositeModel, CompositeLayout } from "../../src/core/composite-chart";
interface CompositeChartPlotProps {
    model: CompositeModel;
    layout: CompositeLayout;
    hiddenSeries: readonly string[];
    cursor?: number;
    presentation: "full" | "minimal";
}
export default function CompositeChartPlot({ model, layout, hiddenSeries, cursor, presentation }: CompositeChartPlotProps): import("react").JSX.Element;
export {};
