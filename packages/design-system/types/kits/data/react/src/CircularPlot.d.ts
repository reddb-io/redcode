import { type ReactNode } from "react";
import { type PieSlice, type DonutReading } from "../../src/core/circular-chart";
import type { ChartPalette } from "../../src/core/chart-color";
export default function CircularPlot({ data, label, thickness, selected, palette, labels, format, height, center, onSelect }: {
    data: readonly PieSlice[];
    label: string;
    thickness?: number;
    selected?: string | null;
    palette?: ChartPalette;
    labels: "none" | "value" | "percent";
    format: (value: number) => string;
    height: string;
    center?: (reading: DonutReading) => ReactNode;
    onSelect?: (id: string) => void;
}): import("react").JSX.Element;
