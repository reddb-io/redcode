import type { ReactNode } from "react";
interface ChartCanvasProps {
    width: number;
    height: number;
    label: string;
    data?: unknown;
    padding?: number | {
        left: number;
        right: number;
        top: number;
        bottom: number;
    };
    children: ReactNode;
}
/** Native SVG coordinate surface. No renderer-specific engine enters this adapter. */
export default function ChartCanvas({ width, height, label, padding, children, }: ChartCanvasProps): import("react").JSX.Element;
export {};
