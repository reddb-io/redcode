/** The vocabulary every DS-built node speaks. */
export declare const SCHEMA_ORG = "https://schema.org";
/** One schema.org node: a `@type` plus its properties. */
export interface JsonLdNode {
    "@context"?: typeof SCHEMA_ORG;
    "@type": string;
    "@id"?: string;
    [property: string]: unknown;
}
/** A top-level JSON-LD document: one node, or a `@graph` of several. */
export type JsonLdDocument = JsonLdNode | {
    "@context": typeof SCHEMA_ORG;
    "@graph": readonly JsonLdNode[];
};
/**
 * Serialize a JSON-LD document so it is safe inside `<script type="application/ld+json">`.
 * Every `<`, `>` and `&` becomes its JSON unicode escape, so caller text containing
 * `</script` or `<!--` can neither close the element nor open a comment, and
 * `JSON.parse` still returns the original value. `undefined` properties are dropped.
 */
export declare function serializeJsonLd(document: JsonLdDocument): string;
/** The complete `<script type="application/ld+json">` element for a document, serialized safely. */
export declare function jsonLdScript(document: JsonLdDocument): string;
/** One crumb: the visible label and, except for the current page, its destination. */
export interface BreadcrumbListInput {
    label: string;
    href?: string;
}
/** Options for {@link breadcrumbList}. */
export interface BreadcrumbListOptions {
    /** Absolute origin (`https://example.com`) that resolves root-relative `href`s. */
    origin?: string;
}
/** Resolve `href` against `origin` when it is root-relative; absolute URLs pass through. */
export declare function absoluteUrl(href: string, origin?: string): string;
/** True when `url` is an absolute `http(s)` URL. */
export declare function isAbsoluteUrl(url: string): boolean;
/**
 * A schema.org `BreadcrumbList` from Breadcrumbs-shaped items, in trail order. Each item
 * becomes a `ListItem` with its 1-based `position`; an item without `href` (the current page)
 * omits `item`, which schema.org allows for the last crumb.
 */
export declare function breadcrumbList(items: readonly BreadcrumbListInput[], options?: BreadcrumbListOptions): JsonLdNode;
