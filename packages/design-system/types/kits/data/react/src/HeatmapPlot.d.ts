interface HeatmapPlotProps {
    start: Date;
    end: Date;
    stepOf: (date: Date) => number;
    width: number;
    height: number;
}
export default function HeatmapPlot({ start, end, stepOf, width, height, }: HeatmapPlotProps): import("react").JSX.Element;
export {};
