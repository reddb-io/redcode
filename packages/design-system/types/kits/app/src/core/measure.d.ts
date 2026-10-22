/** Measure real chrome geometry and keep it synchronized without owning a rendering framework. */
export declare function observeElementSize(element: HTMLElement | null | undefined, changed: (rect: DOMRectReadOnly) => void): () => void;
