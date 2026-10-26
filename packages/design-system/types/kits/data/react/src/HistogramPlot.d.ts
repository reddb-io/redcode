interface HistogramPlotProps {
    data: readonly {
        x0: number;
        x1: number;
        label: string;
        count: number;
    }[];
    width: number;
    height: number;
    padding: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    bandPadding: number;
    countTicks: (scale: {
        ticks?: (count?: number) => unknown[];
    }) => number[];
    binTicks: number;
}
export default function HistogramPlot({ data, width, height, padding, bandPadding, countTicks, binTicks, }: HistogramPlotProps): import("react").JSX.Element;
export {};
