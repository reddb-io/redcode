export declare function useValue<T>(value: T | undefined, fallback: T, changed?: (value: T) => void): readonly [T, (next: T) => void, (next: T) => void];
/** Carry each independent appearance axis across a portal, including live subtree changes. */
export declare function usePortalAppearance(source: {
    current: HTMLElement | null;
}, open: boolean): {
    attributes: Record<string, string>;
    container: HTMLElement | undefined;
};
/** Reconcile the composite's own state after the native reset default action. */
export declare function useNativeFormReset(source: {
    current: HTMLElement | null;
}, reset: () => void): void;
