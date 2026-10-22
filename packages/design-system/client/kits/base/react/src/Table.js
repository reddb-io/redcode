"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { table as tableAppearance } from "../../src/table.variants.js";
function Table({ caption, columns, rows, rowHeader = columns[0]?.key, cell, className, containerClass, captionClass, headerClass, rowClass, headClass, cellClass, ...rest }) {
  const uid = useId();
  const captionId = `${uid}-caption`;
  const styles = tableAppearance();
  return /* @__PURE__ */ jsx("div", { "data-table-scroll": true, role: "region", "aria-labelledby": captionId, tabIndex: 0, className: styles.root({ class: containerClass }), children: /* @__PURE__ */ jsxs("table", { ...rest, "data-table": true, className: styles.table({ class: className }), children: [
    /* @__PURE__ */ jsx("caption", { id: captionId, className: styles.caption({ class: captionClass }), children: caption }),
    /* @__PURE__ */ jsx("thead", { className: styles.header({ class: headerClass }), children: /* @__PURE__ */ jsx("tr", { className: styles.row({ class: rowClass }), children: columns.map((column) => /* @__PURE__ */ jsx("th", { scope: "col", className: styles.head({ class: headClass }), children: column.header }, column.key)) }) }),
    /* @__PURE__ */ jsx("tbody", { children: rows.map((row, rowIndex) => /* @__PURE__ */ jsx("tr", { className: styles.row({ class: rowClass }), children: columns.map((column) => {
      const value = row[column.key];
      const content = cell ? cell({ column, row, value, rowIndex }) : value;
      return column.key === rowHeader ? /* @__PURE__ */ jsx("th", { scope: "row", className: styles.cell({ class: cellClass }), children: content }, column.key) : /* @__PURE__ */ jsx("td", { className: styles.cell({ class: cellClass }), children: content }, column.key);
    }) }, rowIndex)) })
  ] }) });
}
export {
  Table
};
