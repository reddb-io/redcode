const TITLE_FIELDS = ["title", "name", "label", "subject"];
const SUBTITLE_FIELDS = ["subtitle", "description", "summary"];
const BODY_FIELDS = ["body", "content", "text", "markdown"];
const ID_FIELDS = ["id", "_id", "key"];
function scalarText(value) {
  if (typeof value === "string") return value.trim() || void 0;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return void 0;
}
function firstText(document, fields) {
  for (const field of fields) {
    const text = scalarText(document[field]);
    if (text !== void 0) return text;
  }
  return void 0;
}
function preview(value, limit = 120) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1).trimEnd()}\u2026`;
}
function extractDocumentSummary(document, index) {
  const id = firstText(document, ID_FIELDS) ?? String(index);
  const title = firstText(document, TITLE_FIELDS) ?? `Document ${index + 1}`;
  const subtitle = firstText(document, SUBTITLE_FIELDS) ?? firstText(document, BODY_FIELDS) ?? "";
  return { id, title, subtitle: preview(subtitle) };
}
function formatDocumentValue(value) {
  if (value === void 0) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return `${value}n`;
  try {
    const serialized = JSON.stringify(value);
    return serialized === void 0 ? String(value) : serialized;
  } catch {
    return String(value);
  }
}
function documentBody(document) {
  const body = firstText(document, BODY_FIELDS);
  if (body !== void 0) return body;
  return documentRaw(document);
}
function documentFields(document) {
  return Object.entries(document).map(([key, value]) => ({
    key,
    value,
    text: formatDocumentValue(value)
  }));
}
function documentRaw(document) {
  try {
    return JSON.stringify(document, null, 2) ?? String(document);
  } catch {
    return String(document);
  }
}
function presentDocument(document, index) {
  return { summary: extractDocumentSummary(document, index), body: documentBody(document), fields: documentFields(document), raw: documentRaw(document) };
}
function filterDocuments(documents, query, present = presentDocument) {
  const needle = query.trim().toLocaleLowerCase();
  return documents.map((document, index) => ({
    document,
    index,
    // The default list only needs a summary; avoid serializing every raw
    // document before a search or detail view actually needs it.
    presentation: present === presentDocument ? void 0 : present(document, index)
  })).map(({ document, index, presentation }) => ({
    document,
    index,
    presentation,
    summary: presentation?.summary ?? extractDocumentSummary(document, index)
  })).filter(({ document, summary, presentation }) => {
    if (!needle) return true;
    const searchable = presentation?.searchText ?? (presentation?.fields ?? documentFields(document)).map((field) => `${field.key} ${field.text}`).join("\n");
    return [summary.title, summary.subtitle, searchable].join("\n").toLocaleLowerCase().includes(needle);
  }).map(({ document, index, summary }) => ({ document, index, summary }));
}
function visibleDocumentIndex(items, selected) {
  if (selected === null) return null;
  return items.some((item) => item.index === selected) ? selected : items[0]?.index ?? null;
}
export {
  documentBody,
  documentFields,
  documentRaw,
  extractDocumentSummary,
  filterDocuments,
  formatDocumentValue,
  presentDocument,
  visibleDocumentIndex
};
