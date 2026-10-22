import { type ReactNode } from "react";
import type { AccordionContract } from "../../src/core/contracts/accordion";
export interface AccordionProps extends AccordionContract {
    /** Called with expanded values after a user change. */
    onValueChange?: (value: readonly string[]) => void;
    /** Panel content receives its stable item value. */
    children?: (item: {
        value: string;
    }) => ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function Accordion({ label, items, value, multiple, disabled, onValueChange, children, className, triggerClass, contentClass }: AccordionProps): import("react").JSX.Element;
