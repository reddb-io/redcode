const SCHEMA_ORG = "https://schema.org";
const UNSAFE = /[<>&\u2028\u2029]/g;
const ESCAPES = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029"
};
function serializeJsonLd(document) {
  return JSON.stringify(document).replace(UNSAFE, (character) => ESCAPES[character]);
}
function jsonLdScript(document) {
  return `<script type="application/ld+json">${serializeJsonLd(document)}<\/script>`;
}
function absoluteUrl(href, origin) {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || origin === void 0) return href;
  return new URL(href, origin.endsWith("/") ? origin : `${origin}/`).href;
}
function isAbsoluteUrl(url) {
  return /^https?:\/\/[^/\s]+/i.test(url);
}
function breadcrumbList(items, options = {}) {
  return {
    "@context": SCHEMA_ORG,
    "@type": "BreadcrumbList",
    itemListElement: items.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      ...crumb.href === void 0 ? {} : { item: absoluteUrl(crumb.href, options.origin) }
    }))
  };
}
export {
  SCHEMA_ORG,
  absoluteUrl,
  breadcrumbList,
  isAbsoluteUrl,
  jsonLdScript,
  serializeJsonLd
};
