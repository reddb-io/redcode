import type { ReactNode } from "react";
export interface MathExpressionProps {
    /** Inline in a sentence, or a centered display equation. */
    display?: "inline" | "block";
    /** Accessible MathML or other safely rendered mathematical content. */
    children?: ReactNode;
    /** Accessible name of a scrollable display equation. */
    label?: string;
    /** Extra classes merged onto the root. */
    className?: string;
}
export declare function MathExpression({ display, children, label, className }: MathExpressionProps): import("react").JSX.Element;
