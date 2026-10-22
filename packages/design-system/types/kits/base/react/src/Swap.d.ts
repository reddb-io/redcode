import { type ComponentPropsWithRef, type ReactNode } from "react";
export interface SwapProps extends Omit<ComponentPropsWithRef<"button">, "aria-pressed" | "children" | "type" | "onChange"> {
    /** Stable accessible name; words shown by either face must appear in this name. */
    label: string;
    /** Controlled visible face; update it through onSwappedChange. */
    swapped?: boolean;
    /** Initial uncontrolled face; later changes do not replace the user's choice. */
    defaultSwapped?: boolean;
    /** Content in the unpressed state; defaults to label. */
    off?: ReactNode;
    /** Content in the pressed state; defaults to label. */
    on?: ReactNode;
    /** Prevent activation, face changes and callbacks. */
    disabled?: boolean;
    /** Extra classes on the canonical ToggleButton. */
    className?: string;
    /** Native click event before onSwappedChange. */
    onClick?: ComponentPropsWithRef<"button">["onClick"];
    /** Report the requested next face after native activation. */
    onSwappedChange?: (swapped: boolean) => void;
}
export declare function Swap({ label, swapped, defaultSwapped, off, on, disabled, className, onClick, onSwappedChange, ...rest }: SwapProps): import("react").JSX.Element;
