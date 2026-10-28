import { type ComponentPropsWithRef } from "react";
import type { StateIllustrationContract } from "../../src/core/contracts/stateillustration";
export interface StateIllustrationProps extends StateIllustrationContract, Omit<ComponentPropsWithRef<"svg">, keyof StateIllustrationContract | "children" | "role" | "aria-label" | "aria-hidden" | "width" | "height" | "color"> {
    /** Extra classes merged over the Density-owned artwork bounds. */
    className?: string;
}
export declare function StateIllustration({ art, size, accent, decorative, label, className, ...rest }: StateIllustrationProps): import("react").JSX.Element;
