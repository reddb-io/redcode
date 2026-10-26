import { type DocumentMode, type DocumentValue } from "../../src/document";
export { documentBody, documentFields, documentRaw, extractDocumentSummary, filterDocuments, formatDocumentValue, } from "../../src/document";
export type { DocumentField, DocumentItem, DocumentSummary, DocumentValue, } from "../../src/document";
export type { DocumentMode } from "../../src/document";
import type { DocumentViewerContract } from "../../src/core/contracts/documentviewer";
export interface DocumentViewerProps extends DocumentViewerContract {
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
