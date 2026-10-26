"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Fragment as Fragment2 } from "react";
import { formatHex } from "../../src/hex.js";
import { formatHex as formatHex2, hexBytes } from "../../src/hex.js";
function HexViewer(props) {
  const {
    value,
    bytesPerRow = 16,
    label = "Hex viewer",
    className = ""
  } = props;
  const rows = formatHex(value, bytesPerRow);
  const offsetHeader = "Offset".padEnd(rows[0]?.offset.length ?? 8, " ");
  const hexHeader = "Hex".padEnd(bytesPerRow * 3 - 1, " ");
  const asciiHeader = "ASCII".padEnd(bytesPerRow, " ");
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    "div",
    {
      "data-hex-viewer": true,
      role: "table",
      "aria-label": label,
      "aria-colcount": 3,
      "aria-rowcount": rows.length + 1,
      className: `w-full overflow-x-auto rounded-lg border border-muted bg-transparent text-foreground ${className}`.trim(),
      children: /* @__PURE__ */ jsxs("div", { className: "min-w-max font-mono text-sm leading-relaxed", children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            role: "row",
            className: "grid grid-cols-[max-content_max-content_max-content] gap-[var(--reddb-spatial-gap-lg)] border-b border-muted px-[var(--reddb-spatial-inset-md)] py-[var(--reddb-spatial-inset-sm)] font-medium whitespace-pre text-ink-muted",
            children: [
              /* @__PURE__ */ jsx("span", { role: "columnheader", children: offsetHeader }),
              /* @__PURE__ */ jsx("span", { role: "columnheader", children: hexHeader }),
              /* @__PURE__ */ jsx("span", { role: "columnheader", children: asciiHeader })
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          "div",
          {
            role: "rowgroup",
            className: "py-[var(--reddb-spatial-inset-sm)]",
            children: rows.length ? rows.map((row, index) => {
              return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                "div",
                {
                  "data-hex-row": true,
                  role: "row",
                  className: "grid grid-cols-[max-content_max-content_max-content] gap-[var(--reddb-spatial-gap-lg)] px-[var(--reddb-spatial-inset-md)] whitespace-pre hover:bg-foreground/8",
                  children: [
                    /* @__PURE__ */ jsx(
                      "span",
                      {
                        "data-hex-offset": true,
                        role: "cell",
                        className: "text-ink-muted",
                        children: row.offset
                      }
                    ),
                    /* @__PURE__ */ jsx("span", { "data-hex-bytes": true, role: "cell", children: row.hex }),
                    /* @__PURE__ */ jsx(
                      "span",
                      {
                        "data-hex-ascii": true,
                        role: "cell",
                        className: "text-ink-muted",
                        children: row.ascii
                      }
                    )
                  ]
                }
              ) }, row.offset);
            }) : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
              "div",
              {
                role: "row",
                className: "px-[var(--reddb-spatial-inset-md)] py-[var(--reddb-spatial-inset-sm)] text-ink-muted",
                children: /* @__PURE__ */ jsx("span", { role: "cell", "aria-colspan": 3, children: "No bytes." })
              }
            ) })
          }
        )
      ] })
    }
  ) });
}
var HexViewer_default = HexViewer;
export {
  HexViewer,
  HexViewer_default as default,
  formatHex2 as formatHex,
  hexBytes
};
