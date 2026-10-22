/** Focus only a valid in-page target and respect consumer cancellation. */
export declare function focusSkipTarget(event: {
    defaultPrevented: boolean;
}, href: string, document: {
    getElementById(id: string): {
        focus(): void;
    } | null;
}): void;
