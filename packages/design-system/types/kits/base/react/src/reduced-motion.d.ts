export declare const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** Native reactive adapter for the media preference; it never changes an appearance axis. */
export declare function useReducedMotion(): {
    current: boolean;
};
