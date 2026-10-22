"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { SectionHeading, Table } from "@reddb-io/design-system/base";
import { DEFAULT_ORDER_HISTORY_LABELS, orderHistory } from "../../src/composites/order-history.variants.js";
function OrderHistory({ title, level = 2, caption, orders, labels = {}, className, ...rest }) {
  const id = useId(), vocabulary = { ...DEFAULT_ORDER_HISTORY_LABELS, ...labels }, styles = orderHistory();
  const columns = [{ key: "order", header: vocabulary.order }, { key: "placed", header: vocabulary.placed }, { key: "status", header: vocabulary.status }, { key: "total", header: vocabulary.total }];
  return /* @__PURE__ */ jsxs("section", { ...rest, "data-order-history": true, "aria-labelledby": rest["aria-label"] ? void 0 : `${id}-title`, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx(SectionHeading, { id: `${id}-title`, title, level, rule: false, className: styles.heading() }),
    /* @__PURE__ */ jsx(Table, { caption, columns, rows: orders.map((order) => ({ order: order.id, placed: order.placed, status: order.status, total: order.total })), rowHeader: "order", cell: ({ column, value, rowIndex }) => column.key === "placed" ? /* @__PURE__ */ jsx("time", { dateTime: orders[rowIndex]?.placedAt, children: value }) : value })
  ] });
}
export {
  OrderHistory
};
