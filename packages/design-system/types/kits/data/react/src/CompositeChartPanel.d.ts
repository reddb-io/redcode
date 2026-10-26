import { type ReactNode } from "react";
import { type ChartSize, type ChartHeight, type ChartLayout, type ChartReadout, type ChartTimestamp } from "../../src/chart";
import type { ChartLoading } from "../../src/chart-loading";
import { type CompositeModel, type CompositeAxis, type CompositeX } from "../../src/core/composite-chart";
interface CompositeChartPanelProps {
    model: CompositeModel;
    layoutMode: ChartLayout;
    readoutMode: ChartReadout;
    label: string;
    orientation: "vertical" | "horizontal";
    primaryAxis?: CompositeAxis;
    secondaryAxis?: CompositeAxis;
    formatX?: (value: CompositeX) => string;
    presentation: "full" | "minimal";
    legend: "compact" | "hidden";
    interactive: boolean;
    hiddenSeries: readonly string[];
    activeX?: ChartTimestamp | null;
    onActiveChange: (timestamp: number | null) => void;
    onToggle: (id: string) => void;
    size?: ChartSize;
    height?: ChartHeight;
    fill?: boolean;
    loading: ChartLoading;
    actions?: ReactNode;
}
export default function CompositeChartPanel({ model, label, layoutMode, readoutMode, orientation, primaryAxis, secondaryAxis, formatX, presentation, legend, interactive, hiddenSeries, activeX, onActiveChange, onToggle, size, height, fill, loading, actions }: CompositeChartPanelProps): import("react").JSX.Element;
export {};
