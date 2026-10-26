import type { RadialContentContract } from "../../src/core/contracts/radialcontent";
export interface RadialContentProps extends RadialContentContract {
    /** Extra classes merged on the central composition. */
    className?: string;
}
export declare function RadialContent({ title, value, description, avatar, className }: RadialContentProps): import("react").JSX.Element;
