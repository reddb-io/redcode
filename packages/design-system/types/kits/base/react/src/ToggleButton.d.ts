import { type ComponentPropsWithRef, type ReactNode } from "react";
export interface ToggleButtonProps extends Omit<ComponentPropsWithRef<"button">, "aria-pressed" | "children" | "type"> {
    /** Required stable accessible name; visible child words must appear in it. */
    label: string;
    /** Controlled pressed state; update it through onPressedChange. */
    pressed?: boolean;
    /** Initial uncontrolled state; later changes do not replace the user's choice. */
    defaultPressed?: boolean;
    /** Whether an already pressed button may be unpressed. */
    allowUnpress?: boolean;
    /** Prevent activation and change callbacks. */
    disabled?: boolean;
    /** Optional visual content; label remains the accessible name. */
    children?: ReactNode;
    /** Native click event after the state-change callback. */
    onClick?: ComponentPropsWithRef<"button">["onClick"];
    /** Called with the next pressed state when activation changes it. */
    onPressedChange?: (pressed: boolean) => void;
}
export declare function ToggleButton({ label, pressed, defaultPressed, allowUnpress, disabled, children, className, onClick, onPressedChange, ...rest }: ToggleButtonProps): import("react").JSX.Element;
