/**
 * The element the region belongs in: the topmost open modal dialog, else the
 * body. A modal `<dialog>` makes everything outside it inert (ADR 0017), so a
 * toast with an action must move inside it to stay reachable.
 */
export declare function toasterHost(doc?: Document): HTMLElement;
/** Call `onchange` with the region's host now and whenever a modal opens or closes. Returns the teardown. */
export declare function watchToasterHost(doc: Document, onchange: (host: HTMLElement) => void): () => void;
/** Pause the queue while a person reads or acts: hover, focus inside, or a blurred window. Returns the teardown. */
export declare function watchToasterAttention(region: HTMLElement, pause: () => void, resume: () => void): () => void;
/** Both, for an adapter that may move its own region (Svelte): keep it in its host and pause on attention. */
export declare function connectToaster(region: HTMLElement, pause: () => void, resume: () => void): () => void;
