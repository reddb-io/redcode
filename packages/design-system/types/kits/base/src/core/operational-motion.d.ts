/** Native visibility/motion observation with adapter-owned cleanup. */
export declare function observeActivity(element: Element, change: (allowed: boolean) => void): () => void;
/** Semantics update immediately; only paint receives an optional fade. */
export declare function valuePresentation(element: HTMLElement): {
    update(next: unknown, enabled: boolean): void;
    destroy(): void;
};
/** A decorative clone never owns committed state or focus. */
export declare function transferPresentation(host: HTMLElement, fromId: string, toId: string, duration: number): () => void;
