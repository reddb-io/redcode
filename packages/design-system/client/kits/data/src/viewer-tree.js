function dottedPath(parent, segment) {
  const part = String(segment);
  return parent === "$" || parent.length === 0 ? part : `${parent}.${part}`;
}
function displayValue(value) {
  if (value === void 0) return "undefined";
  if (typeof value === "bigint") return `${value}n`;
  const serialized = JSON.stringify(value);
  return serialized === void 0 ? String(value) : serialized;
}
function jsonNode(key, value, path) {
  if (Array.isArray(value)) {
    return {
      id: path,
      label: key,
      children: value.map((item, index) => jsonNode(String(index), item, dottedPath(path, index)))
    };
  }
  if (typeof value === "object" && value !== null) {
    return {
      id: path,
      label: key,
      children: Object.entries(value).map(
        ([childKey, item]) => jsonNode(childKey, item, dottedPath(path, childKey))
      )
    };
  }
  return { id: path, label: `${key}: ${displayValue(value)}`, value, children: [] };
}
function buildJsonTree(value) {
  if (Array.isArray(value)) {
    return value.map((item, index) => jsonNode(String(index), item, String(index)));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).map(([key, item]) => jsonNode(key, item, key));
  }
  return [jsonNode("$", value, "$")];
}
function decodeXml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    if (code.toLowerCase().startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[code.toLowerCase()];
  });
}
function parseXml(source) {
  const roots = [];
  const stack = [];
  const tokens = source.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<?") || /^<!DOCTYPE\b/i.test(token)) {
      continue;
    }
    if (token.startsWith("<![CDATA[")) {
      if (!stack.length) throw new SyntaxError("XML text must belong to an element.");
      stack.at(-1).text.push(token.slice(9, -3));
      continue;
    }
    if (token.startsWith("</")) {
      const name = token.slice(2, -1).trim();
      if (stack.pop()?.name !== name) throw new SyntaxError(`Unexpected closing XML tag: ${name}`);
      continue;
    }
    if (token.startsWith("<")) {
      const match = token.match(/^<([^\s/>]+)([\s\S]*?)\/?\s*>$/);
      if (!match) throw new SyntaxError(`Invalid XML tag: ${token}`);
      const attributes = [];
      const attributeSource = match[2] ?? "";
      const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      for (const attribute of attributeSource.matchAll(attributePattern)) {
        attributes.push([attribute[1], decodeXml(attribute[2] ?? attribute[3] ?? "")]);
      }
      const element = { name: match[1], attributes, children: [], text: [] };
      const parent = stack.at(-1);
      if (parent) parent.children.push(element);
      else roots.push(element);
      if (!/\/\s*>$/.test(token)) stack.push(element);
      continue;
    }
    if (token.trim()) {
      if (!stack.length) throw new SyntaxError("XML text must belong to an element.");
      stack.at(-1).text.push(decodeXml(token));
    }
  }
  if (stack.length) throw new SyntaxError(`Unclosed XML tag: ${stack.at(-1).name}`);
  if (roots.length !== 1) throw new SyntaxError("XML must contain exactly one root element.");
  return roots;
}
function xmlNodes(elements, parent = "") {
  const totals = /* @__PURE__ */ new Map();
  for (const element of elements) totals.set(element.name, (totals.get(element.name) ?? 0) + 1);
  const seen = /* @__PURE__ */ new Map();
  return elements.map((element) => {
    const occurrence = seen.get(element.name) ?? 0;
    seen.set(element.name, occurrence + 1);
    const namePath = dottedPath(parent, element.name);
    const path = totals.get(element.name) > 1 ? dottedPath(namePath, occurrence) : namePath;
    const text = element.text.join("").replace(/\s+/g, " ").trim();
    const children = element.attributes.map(([name, value]) => ({
      id: dottedPath(path, `@${name}`),
      label: `@${name}: ${displayValue(value)}`,
      value,
      children: []
    }));
    children.push(...xmlNodes(element.children, path));
    if (text && element.children.length > 0) {
      children.push({
        id: dottedPath(path, "$text"),
        label: `#text: ${displayValue(text)}`,
        value: text,
        children: []
      });
    }
    return {
      id: path,
      label: text && children.length === 0 ? `<${element.name}>: ${displayValue(text)}` : `<${element.name}>`,
      ...text && children.length === 0 ? { value: text } : {},
      children
    };
  });
}
function buildXmlTree(source) {
  return xmlNodes(parseXml(source));
}
export {
  buildJsonTree,
  buildXmlTree,
  dottedPath
};
