import type { ComponentPropsWithRef, ReactNode } from "react";
import { type ButtonSize, type ButtonTone, type ButtonVariant } from "../../src/button.variants";
interface ButtonAppearance {
    /** Emphasis; secondary is the default. */
    variant?: ButtonVariant;
    /** Shared semantic meaning; neutral is the default. */
    tone?: ButtonTone;
    /** Density-responsive control step. */
    size?: ButtonSize;
    /** Keep the label, add a spinner and prevent activation. */
    loading?: boolean;
    /** Fill the available inline space. */
    block?: boolean;
    /** Prevent native button or link activation. */
    disabled?: boolean;
    /** Visible label or accessible icon content. */
    children?: ReactNode;
}
export type ButtonProps = ButtonAppearance & ((Omit<ComponentPropsWithRef<"button">, keyof ButtonAppearance> & {
    href?: never;
}) | (Omit<ComponentPropsWithRef<"a">, keyof ButtonAppearance> & {
    href: string;
}));
/** A native button or link using the canonical Button appearance recipe. */
export declare function Button({ variant, tone, size, loading, block, disabled, children, className, ...rest }: ButtonProps): import("react").JSX.Element;
export {};
