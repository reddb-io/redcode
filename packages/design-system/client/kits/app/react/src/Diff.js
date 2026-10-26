import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Fragment as Fragment2 } from "react";
import { SplitView } from "./SplitView.js";
import { diff } from "../../src/composites/diff.variants.js";
function Diff({
  label = "Changes",
  rows,
  mode = "inline",
  beforeLabel = "Before",
  afterLabel = "After",
  separatorLabel = "Resize before and after panes",
  className,
  ...rest
}) {
  const styles = diff();
  const line = (value, change, key) => /* @__PURE__ */ jsxs(
    "div",
    {
      "data-diff-line": true,
      "data-change-kind": change,
      role: change === "empty" ? void 0 : "listitem",
      "aria-hidden": change === "empty" || void 0,
      "aria-label": change === "addition" ? `Added: ${value}` : change === "removal" ? `Removed: ${value}` : void 0,
      className: styles.line({ change }),
      children: [
        /* @__PURE__ */ jsx(
          "span",
          {
            "data-diff-marker": true,
            "aria-hidden": change === "empty" ? void 0 : true,
            className: styles.marker(),
            children: change === "addition" ? "+" : change === "removal" ? "\u2212" : ""
          }
        ),
        /* @__PURE__ */ jsx("code", { children: value })
      ]
    },
    key
  );
  const pane = (side) => /* @__PURE__ */ jsxs(
    "section",
    {
      "data-diff-pane": side,
      "aria-label": side === "before" ? beforeLabel : afterLabel,
      className: styles.pane(),
      children: [
        /* @__PURE__ */ jsx(
          "div",
          {
            "data-diff-pane-heading": true,
            "aria-hidden": "true",
            className: styles.heading(),
            children: side === "before" ? beforeLabel : afterLabel
          }
        ),
        /* @__PURE__ */ jsx(
          "div",
          {
            role: "list",
            tabIndex: 0,
            "aria-label": side === "before" ? beforeLabel : afterLabel,
            className: styles.lines(),
            children: rows.map(
              (row, index) => line(
                row[side],
                row[side] === void 0 ? "empty" : row.before === row.after ? "context" : side === "before" ? "removal" : "addition",
                String(index)
              )
            )
          }
        )
      ]
    }
  );
  return /* @__PURE__ */ jsx(
    "div",
    {
      ...rest,
      "data-diff": true,
      "data-mode": mode,
      role: "region",
      "aria-label": label,
      className: styles.root({ class: className }),
      children: mode === "side-by-side" ? /* @__PURE__ */ jsx(
        SplitView,
        {
          start: pane("before"),
          end: pane("after"),
          label: separatorLabel,
          className: styles.split()
        }
      ) : /* @__PURE__ */ jsx(
        "div",
        {
          role: "list",
          tabIndex: 0,
          "aria-label": label,
          className: styles.lines(),
          children: rows.map((row, index) => /* @__PURE__ */ jsx(Fragment2, { children: row.before !== void 0 && row.before === row.after ? line(row.before, "context") : /* @__PURE__ */ jsxs(Fragment, { children: [
            row.before !== void 0 && line(row.before, "removal"),
            row.after !== void 0 && line(row.after, "addition")
          ] }) }, index))
        }
      )
    }
  );
}
export {
  Diff
};
