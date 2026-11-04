import { type ProjectionChartContract } from "../../src/projection-chart";
export type { ProjectionPoint, ProjectionMetric, ProjectionAnnotation, ProjectionChartContract } from "../../src/projection-chart";
export interface ProjectionChartProps extends ProjectionChartContract {
    /** Additional surface classes. */
    className?: string;
}
export declare function ProjectionChart(props: ProjectionChartProps): import("react").JSX.Element;
export default ProjectionChart;
