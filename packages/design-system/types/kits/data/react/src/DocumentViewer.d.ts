import { type ReactNode } from "react";
import { type DocumentMode, type DocumentValue } from "../../src/document";
export { documentBody, documentFields, documentRaw, extractDocumentSummary, filterDocuments, formatDocumentValue, presentDocument, visibleDocumentIndex, } from "../../src/document";
export type { DocumentPresentation, DocumentPresenter, DocumentField, DocumentItem, DocumentSummary, DocumentValue, } from "../../src/document";
export type { DocumentMode } from "../../src/document";
import type { DocumentViewerContract } from "../../src/core/contracts/documentviewer";
export interface DocumentViewerProps extends DocumentViewerContract {
    /** Custom recovery content when no document matches; receives a clear-and-focus action. */
    empty?: (context: {
        clear: () => void;
    }) => ReactNode;
    /** Item activation (ADR 0026's sanctioned `onSelect`): the document chosen from the list. */
    onSelect?: (document: DocumentValue, index: number) => void;
    /** Reports the detail mode the reader switched to. */
    onModeChange?: (mode: DocumentMode) => void;
    /**
     * Extra classes, merged onto the root `section` that holds both the list and the detail pane.
     */
    className?: string;
}
export declare function DocumentViewer(props: DocumentViewerProps): import("react").JSX.Element;
export default DocumentViewer;
