import { type ReactNode } from "react";
import { type VisualizationSeries, type VisualizationRow, type VisualizationSize } from "../../src/visualization";
interface VisualizationFrameProps {
    label: string;
    description?: string;
    kind: string;
    width?: number;
    height?: number;
    widthUnits?: number;
    heightUnits?: number;
    size?: VisualizationSize;
    rows?: readonly VisualizationRow[];
    legend?: readonly {
        id: string;
        label: string;
        series?: VisualizationSeries;
    }[];
    selected?: string;
    onSelect?: (id: string) => void;
    detailHref?: string;
    className?: string;
    children: (box: {
        width: number;
        height: number;
        unit: number;
    }) => ReactNode;
}
export default function VisualizationFrame({ label, description, kind, width, height, widthUnits, heightUnits, size, rows, legend, selected, onSelect, detailHref, className, children, }: VisualizationFrameProps): import("react").JSX.Element;
export {};
