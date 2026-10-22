import { type ComponentPropsWithRef, type ReactNode } from "react";
import { type RevealDirection } from "../../src/core/reveal";
export interface RevealProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
    /** The edge content enters from. */
    direction?: RevealDirection;
    /** Milliseconds to wait before entering. */
    delay?: number;
    /** Show the entry range while tuning a composition. */
    debug?: boolean;
    /** Extra classes merged onto the primitive. */
    className?: string;
    /** Content that enters the viewport with the reveal. */
    children?: ReactNode;
}
export declare function Reveal({ direction, delay, debug, className, children, style, ref, ...rest }: RevealProps): import("react").JSX.Element;
export type { RevealDirection } from "../../src/core/reveal";
