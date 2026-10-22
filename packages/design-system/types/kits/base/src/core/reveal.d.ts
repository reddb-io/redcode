export declare const REVEAL_DIRECTIONS: readonly ["up", "down", "left", "right", "none"];
export type RevealDirection = typeof REVEAL_DIRECTIONS[number];
export interface RevealState {
    path: "css" | "js";
    entered: boolean;
    reducedMotion: boolean;
}
/** Useful, visible SSR; adapters adopt the same initial state before native effects run. */
export declare function initialRevealState(): RevealState;
export declare function revealDelay(delay: number): number;
/** Native browser behavior with no rendering runtime; disposed by each adapter. */
export declare function mountReveal(element: HTMLElement, direction: RevealDirection, delay: number, changed: (state: RevealState) => void): () => void;
