import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { Button, Input, quietControl } from "@reddb-io/design-system/base";
import { TreeView } from "./TreeView.js";
import {
  filterKvEntries,
  kvTreeNodes,
  kvExpandedIds,
  kvEntryAt,
  materializeKvJson,
  formatValue
} from "../../src/key-value-explorer.js";
import { explorerClasses as styles } from "../../src/diff-explorer.variants.js";
function KeyValueExplorer({
  label,
  entries,
  context,
  emptyLabel = "No keys to inspect.",
  className = ""
}) {
  const [mode, setMode] = useState("tree"), [prefix, setPrefix] = useState("");
  const [selected, setSelected] = useState(null), [expanded, setExpanded] = useState();
  const input = useRef(null);
  const filtered = filterKvEntries(entries, prefix), nodes = kvTreeNodes(filtered), active = kvEntryAt(filtered, selected);
  return /* @__PURE__ */ jsxs(
    "section",
    {
      "data-key-value-explorer": true,
      "aria-label": label,
      className: `@container ${styles.root} ${className}`,
      children: [
        /* @__PURE__ */ jsxs("div", { className: styles.toolbar, children: [
          ["tree", "json"].map((view) => /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              "aria-pressed": mode === view,
              className: quietControl({
                selected: mode === view,
                class: "px-[var(--reddb-spatial-inset-sm)]"
              }),
              onClick: () => setMode(view),
              children: view === "tree" ? "Tree" : "JSON"
            },
            view
          )),
          /* @__PURE__ */ jsxs("label", { children: [
            "Key prefix",
            " ",
            /* @__PURE__ */ jsx(
              Input,
              {
                "aria-label": "Key prefix",
                value: prefix,
                onChange: (e) => setPrefix(e.currentTarget.value),
                ref: input
              }
            )
          ] }),
          prefix && /* @__PURE__ */ jsx(
            Button,
            {
              onClick: () => {
                setPrefix("");
                input.current?.focus();
              },
              children: "Clear prefix"
            }
          ),
          /* @__PURE__ */ jsxs("span", { children: [
            filtered.length,
            " of ",
            entries.length,
            " keys",
            context ? ` \xB7 ${context}` : ""
          ] })
        ] }),
        !entries.length ? /* @__PURE__ */ jsx("p", { className: styles.detail, children: emptyLabel }) : !filtered.length ? /* @__PURE__ */ jsx("p", { className: styles.detail, children: "No keys match prefix." }) : mode === "json" ? /* @__PURE__ */ jsx("pre", { className: styles.raw, children: JSON.stringify(materializeKvJson(entries, prefix.trim()), null, 2) }) : /* @__PURE__ */ jsxs("div", { className: styles.content, children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              className: styles.list,
              role: "region",
              "aria-label": "Keys",
              tabIndex: 0,
              children: /* @__PURE__ */ jsx(
                TreeView,
                {
                  label: "Keys",
                  nodes,
                  expanded: expanded ?? kvExpandedIds(nodes),
                  onExpandedChange: setExpanded,
                  selected: active ? selected : null,
                  onSelectedChange: setSelected,
                  renamable: false,
                  reorderable: false
                }
              )
            }
          ),
          /* @__PURE__ */ jsx(
            "div",
            {
              className: styles.detail,
              role: "region",
              "aria-label": "Value",
              tabIndex: 0,
              children: active ? /* @__PURE__ */ jsxs(Fragment, { children: [
                /* @__PURE__ */ jsx("p", { children: active.key }),
                /* @__PURE__ */ jsx("pre", { className: styles.value, children: formatValue(active.value) })
              ] }) : /* @__PURE__ */ jsx("p", { children: "Select a key to inspect its value." })
            }
          )
        ] })
      ]
    }
  );
}
var KeyValueExplorer_default = KeyValueExplorer;
export {
  KeyValueExplorer,
  KeyValueExplorer_default as default
};
