/** The portal retains its source's independent appearance axes and native modal boundary. */
export declare function observePortalAppearance(source: HTMLElement, changed: (state: {
    attributes: Record<string, string>;
    container: HTMLElement | undefined;
}) => void): () => void;
