import { type ReactNode } from "react";
import { type FieldContractProps, type FieldControlProps } from "../../src/core/field";
export interface FieldProps extends FieldContractProps {
    /** Additional classes on the field root. */
    className?: string;
    /** Render the control with the complete accessible association. */
    children: (control: FieldControlProps) => ReactNode;
}
export declare function Field({ label, help, error, required, id, layout, className, children }: FieldProps): import("react").JSX.Element;
