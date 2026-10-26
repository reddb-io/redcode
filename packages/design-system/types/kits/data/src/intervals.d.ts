import { type VisualizationItem } from "./visualization";
export interface TimeInterval extends VisualizationItem {
    start: number;
    end: number;
    parentId?: string;
    dependencies?: readonly string[];
    progress?: number;
    tone?: "neutral" | "success" | "warning" | "danger";
    attributes?: Readonly<Record<string, string>>;
}
export declare function intervalRows(data: readonly TimeInterval[], collapsed?: readonly string[]): (TimeInterval & {
    depth: number;
})[];
export declare function intervalDomain(data: readonly TimeInterval[], explicit?: readonly [number, number]): [number, number];
