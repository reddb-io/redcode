import type { SchemaPlotContract } from "../../src/core/contracts/schemaplot";
export interface SchemaPlotProps extends SchemaPlotContract {
    onSelectedChange?: (id: string) => void;
    className?: string;
}
export declare function SchemaPlot(props: SchemaPlotProps): import("react").JSX.Element;
export default SchemaPlot;
