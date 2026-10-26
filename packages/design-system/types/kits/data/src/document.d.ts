/** Pure extraction and filtering for the dependency-free Document viewer. */
export type DocumentValue = Readonly<Record<string, unknown>>;
export interface DocumentSummary {
    id: string;
    title: string;
    subtitle: string;
}
export interface DocumentItem {
    document: DocumentValue;
    index: number;
    summary: DocumentSummary;
}
export interface DocumentField {
    key: string;
    value: unknown;
    text: string;
}
/** Extract stable master-list identity and display text from common document fields. */
export declare function extractDocumentSummary(document: DocumentValue, index: number): DocumentSummary;
/** Stable, dependency-free presentation for field and raw modes. */
export declare function formatDocumentValue(value: unknown): string;
/** Select the conventional long-form field shown by body mode. */
export declare function documentBody(document: DocumentValue): string;
/** Return caller fields in insertion order for the fields detail mode. */
export declare function documentFields(document: DocumentValue): readonly DocumentField[];
/** Pretty JSON used by raw mode, with a safe fallback for non-JSON values. */
export declare function documentRaw(document: DocumentValue): string;
/** Filter documents without changing their original indexes or caller-owned values. */
export declare function filterDocuments(documents: readonly DocumentValue[], query: string): readonly DocumentItem[];
/** Master-detail presentation modes shared by native renderers. */
export type DocumentMode = "body" | "fields" | "raw";
