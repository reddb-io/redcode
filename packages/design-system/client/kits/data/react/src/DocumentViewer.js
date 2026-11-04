"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Fragment as Fragment2, useRef, useState } from "react";
import { Button, Heading, Input, Tabs } from "@reddb-io/design-system/base";
import { quietControl } from "@reddb-io/design-system/base";
import {
  filterDocuments,
  presentDocument,
  visibleDocumentIndex
} from "../../src/document.js";
import {
  documentBody,
  documentFields,
  documentRaw,
  extractDocumentSummary,
  filterDocuments as filterDocuments2,
  formatDocumentValue,
  presentDocument as presentDocument2,
  visibleDocumentIndex as visibleDocumentIndex2
} from "../../src/document.js";
function DocumentViewer(props) {
  const {
    documents,
    present = presentDocument,
    label = "Documents",
    selected: controlledSelected,
    onSelect,
    mode: controlledMode,
    onModeChange,
    empty,
    className = ""
  } = props;
  const [query, setQuery] = useState("");
  const filterInput = useRef(null);
  const [localSelected, setLocalSelected] = useState(0);
  const [localMode, setLocalMode] = useState("body");
  const items = filterDocuments(documents, query, present);
  const activeMode = controlledMode ?? localMode;
  const activeIndex = visibleDocumentIndex(items, resolveSelectedIndex(
    controlledSelected === void 0 ? localSelected : controlledSelected
  ));
  const activeDocument = activeIndex === null ? void 0 : documents[activeIndex];
  const activePresentation = activeDocument && activeIndex !== null ? present(activeDocument, activeIndex) : void 0;
  const activeSummary = activePresentation?.summary;
  function resolveSelectedIndex(selected) {
    if (selected === null) return null;
    if (typeof selected === "number") {
      return selected >= 0 && selected < documents.length ? selected : null;
    }
    const index = documents.findIndex(
      (document, documentIndex) => present(document, documentIndex).summary.id === selected
    );
    return index < 0 ? null : index;
  }
  function clearFilter() {
    setQuery("");
    filterInput.current?.focus();
  }
  function select(item) {
    setLocalSelected(item.index);
    onSelect?.(item.document, item.index);
  }
  function setMode(mode) {
    setLocalMode(mode);
    onModeChange?.(mode);
  }
  const modes = [
    { value: "body", label: "Body" },
    { value: "fields", label: "Fields" },
    { value: "raw", label: "Raw" }
  ];
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    "section",
    {
      "data-document-viewer": true,
      "data-document-mode": activeMode,
      "aria-label": label,
      className: `@container/document-viewer min-h-0 w-full overflow-hidden rounded-lg border border-muted bg-transparent text-foreground ${className}`.trim(),
      children: /* @__PURE__ */ jsxs(
        "div",
        {
          "data-document-panes": true,
          className: "grid min-h-0 grid-cols-1 @2xl/document-viewer:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]",
          children: [
            /* @__PURE__ */ jsxs(
              "div",
              {
                className: "min-w-0 border-b border-muted @2xl/document-viewer:border-r",
                children: [
                  /* @__PURE__ */ jsx(
                    "div",
                    {
                      className: "border-b border-muted p-[var(--reddb-spatial-inset-sm)]",
                      children: /* @__PURE__ */ jsx(
                        Input,
                        {
                          ref: filterInput,
                          value: query,
                          onValueChange: setQuery,
                          "aria-label": "Filter documents",
                          type: "search",
                          placeholder: "Filter documents",
                          className: "w-full"
                        }
                      )
                    }
                  ),
                  items.length ? /* @__PURE__ */ jsx(
                    "div",
                    {
                      role: "listbox",
                      "aria-label": `${label} list`,
                      className: "max-h-full overflow-y-auto p-[var(--reddb-spatial-inset-sm)]",
                      children: items.map((item, index) => {
                        return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                          "button",
                          {
                            type: "button",
                            role: "option",
                            "aria-selected": item.index === activeIndex,
                            onClick: () => select(item),
                            className: quietControl({
                              ink: "foreground",
                              selected: item.index === activeIndex,
                              class: "block w-full rounded-md px-[var(--reddb-spatial-inset-sm)] py-[var(--reddb-spatial-inset-sm)] text-left"
                            }),
                            children: [
                              /* @__PURE__ */ jsx("span", { className: "block font-medium", children: item.summary.title }),
                              item.summary.subtitle ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                                "span",
                                {
                                  className: "block truncate text-sm text-ink-muted",
                                  children: item.summary.subtitle
                                }
                              ) }) : null
                            ]
                          }
                        ) }, item.index);
                      })
                    }
                  ) : /* @__PURE__ */ jsx("div", { "data-document-empty": true, className: "px-[var(--reddb-spatial-inset-sm)] py-[var(--reddb-spatial-inset-md)] text-sm text-ink-muted", children: empty ? empty({ clear: clearFilter }) : /* @__PURE__ */ jsxs(Fragment, { children: [
                    /* @__PURE__ */ jsx("p", { className: "m-0", children: "No documents match." }),
                    query ? /* @__PURE__ */ jsx(Button, { size: "sm", onClick: clearFilter, children: "Clear filter" }) : null
                  ] }) })
                ]
              }
            ),
            /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
              /* @__PURE__ */ jsxs(
                "div",
                {
                  className: "border-b border-muted p-[var(--reddb-spatial-inset-md)]",
                  children: [
                    /* @__PURE__ */ jsx(
                      Heading,
                      {
                        level: 2,
                        role: "heading",
                        "data-document-title": true,
                        className: "m-0 truncate",
                        children: activeSummary?.title ?? "No document selected"
                      }
                    ),
                    activeSummary?.subtitle ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("p", { className: "m-0 truncate text-sm text-ink-muted", children: activeSummary.subtitle }) }) : null
                  ]
                }
              ),
              /* @__PURE__ */ jsx(
                Tabs,
                {
                  label: "Document detail mode",
                  items: modes,
                  value: activeMode,
                  onValueChange: (mode) => setMode(mode),
                  listClass: "px-[var(--reddb-spatial-inset-md)]",
                  contentClass: "min-w-0 overflow-auto p-[var(--reddb-spatial-inset-md)]",
                  children: ({ value }) => {
                    return /* @__PURE__ */ jsx(Fragment, { children: activeDocument ? /* @__PURE__ */ jsx(Fragment, { children: value === "body" ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                      "div",
                      {
                        "data-document-body": true,
                        className: "whitespace-pre-wrap break-words",
                        children: activePresentation.body
                      }
                    ) }) : /* @__PURE__ */ jsx(Fragment, { children: value === "fields" ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                      "dl",
                      {
                        className: "m-0 grid gap-[var(--reddb-spatial-gap-sm)]",
                        children: activePresentation.fields.map(
                          (field, index) => {
                            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                              "div",
                              {
                                "data-document-field": true,
                                className: "grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-[var(--reddb-spatial-gap-md)] border-b border-muted py-[var(--reddb-spatial-inset-sm)]",
                                children: [
                                  /* @__PURE__ */ jsx("dt", { className: "font-medium", children: field.key }),
                                  /* @__PURE__ */ jsx(
                                    "dd",
                                    {
                                      className: "m-0 min-w-0 whitespace-pre-wrap break-words font-mono text-sm",
                                      children: field.text
                                    }
                                  )
                                ]
                              }
                            ) }, field.key);
                          }
                        )
                      }
                    ) }) : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                      "pre",
                      {
                        "data-document-raw": true,
                        className: "m-0 min-w-max whitespace-pre font-mono text-sm",
                        children: activePresentation.raw
                      }
                    ) }) }) }) : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("p", { className: "m-0 text-ink-muted", children: "Select a document to inspect it." }) }) });
                  }
                }
              )
            ] })
          ]
        }
      )
    }
  ) });
}
var DocumentViewer_default = DocumentViewer;
export {
  DocumentViewer,
  DocumentViewer_default as default,
  documentBody,
  documentFields,
  documentRaw,
  extractDocumentSummary,
  filterDocuments2 as filterDocuments,
  formatDocumentValue,
  presentDocument2 as presentDocument,
  visibleDocumentIndex2 as visibleDocumentIndex
};
