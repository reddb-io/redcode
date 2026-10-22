import type { StepItem } from "../../src/core/steps";
export type { StepItem, StepState } from "../../src/core/steps";
export interface StepsProps {
    /**
     * The steps in order; each has an `id`, a `label`, a `state` of `complete`, `current` or
     * `upcoming`, and an optional `href` that makes a non-current step a link.
     */
    items: readonly StepItem[];
    /** Accessible name of the navigation landmark; defaults to `Progress`. */
    label?: string;
    /** Extra classes, merged over the root slot's own. */
    className?: string;
}
export declare function Steps({ items, label, className }: StepsProps): import("react").JSX.Element;
