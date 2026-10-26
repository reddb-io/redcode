import type { ReactNode } from "react";
interface VisualizationMarkProps {
    id: string;
    label: string;
    selected?: string;
    onSelect?: (id: string) => void;
    children: ReactNode;
}
export default function VisualizationMark({ id, label, selected, onSelect, children, }: VisualizationMarkProps): import("react").JSX.Element;
export {};
