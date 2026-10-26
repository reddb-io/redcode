"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Fragment as Fragment2 } from "react";
import {
  diffFields,
  diffLines,
  formatDiffValue
} from "../../src/diff.js";
import { diffFields as diffFields2, diffLines as diffLines2, formatDiffValue as formatDiffValue2 } from "../../src/diff.js";
function Diff(props) {
  const {
    before,
    after,
    mode = "fields",
    label = "Changes",
    showUnchanged = true,
    className = ""
  } = props;
  const result = mode === "lines" ? diffLines(String(before ?? ""), String(after ?? "")) : diffFields(before, after);
  const entries = showUnchanged ? result.entries : result.entries.filter((entry) => entry.kind !== "unchanged");
  const markers = {
    added: "+",
    removed: "\u2212",
    changed: "~",
    unchanged: " "
  };
  function lineClasses(kind) {
    if (kind === "added") {
      return "bg-[var(--reddb-color-feedback-success-surface)] text-[var(--reddb-color-feedback-success-foreground)]";
    }
    if (kind === "removed") {
      return "bg-[var(--reddb-color-feedback-danger-surface)] text-[var(--reddb-color-feedback-danger-foreground)]";
    }
    if (kind === "changed") {
      return "bg-[var(--reddb-color-feedback-warning-surface)] text-[var(--reddb-color-feedback-warning-foreground)]";
    }
    return "bg-transparent text-foreground";
  }
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
    "section",
    {
      "data-diff-viewer": true,
      "data-mode": mode,
      "aria-label": label,
      className: `w-full min-w-0 overflow-hidden rounded-lg border border-muted bg-transparent text-foreground ${className}`.trim(),
      children: [
        /* @__PURE__ */ jsxs(
          "p",
          {
            "data-diff-summary": true,
            "aria-live": "polite",
            className: "m-0 border-b border-muted px-[var(--reddb-spatial-inset-md)] py-[var(--reddb-spatial-inset-sm)] text-sm font-medium",
            children: [
              result.summary.added,
              " added \xB7 ",
              result.summary.removed,
              " removed \xB7 ",
              result.summary.changed,
              " changed \xB7 ",
              result.summary.unchanged,
              " unchanged "
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          "div",
          {
            role: "list",
            className: "m-0 overflow-x-auto py-[var(--reddb-spatial-inset-sm)] font-mono text-sm leading-relaxed",
            children: entries.map((entry, index) => {
              return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                "div",
                {
                  "data-diff-entry": true,
                  "data-change-kind": entry.kind,
                  role: "listitem",
                  "aria-label": `${entry.kind}: ${entry.path}`,
                  className: `grid grid-cols-[auto_minmax(0,1fr)] gap-[var(--reddb-spatial-gap-sm)] px-[var(--reddb-spatial-inset-md)] whitespace-pre ${lineClasses(entry.kind)}`,
                  children: [
                    /* @__PURE__ */ jsx(
                      "span",
                      {
                        "data-diff-marker": true,
                        "aria-hidden": "true",
                        className: "select-none",
                        children: markers[entry.kind]
                      }
                    ),
                    /* @__PURE__ */ jsxs("span", { className: "min-w-0", children: [
                      /* @__PURE__ */ jsx("strong", { children: entry.path }),
                      entry.kind === "changed" ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs("span", { children: [
                        ": ",
                        /* @__PURE__ */ jsx("del", { children: formatDiffValue(entry.before) }),
                        " \u2192 ",
                        /* @__PURE__ */ jsx("ins", { children: formatDiffValue(entry.after) })
                      ] }) }) : /* @__PURE__ */ jsx(Fragment, { children: entry.kind === "removed" ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs("span", { children: [
                        ": ",
                        formatDiffValue(entry.before)
                      ] }) }) : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs("span", { children: [
                        ": ",
                        formatDiffValue(entry.after)
                      ] }) }) })
                    ] })
                  ]
                }
              ) }, `${entry.path}:${entry.kind}:${index}`);
            })
          }
        )
      ]
    }
  ) });
}
var Diff_default = Diff;
export {
  Diff,
  Diff_default as default,
  diffFields2 as diffFields,
  diffLines2 as diffLines,
  formatDiffValue2 as formatDiffValue
};
