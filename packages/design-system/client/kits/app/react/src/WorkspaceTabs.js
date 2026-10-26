"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useId
} from "react";
import { Tabs as Managed } from "@base-ui/react/tabs";
import { Button, quietControl } from "@reddb-io/design-system/base";
import {
  workspaceTabs,
  workspaceSelection,
  mountWorkspaceFocus
} from "../../src/core/workspace-tabs.js";
import { workspaceTabsAppearance } from "../../src/workspace-tabs.variants.js";
function WorkspaceTabs({
  label,
  items,
  selected,
  onselectedchange,
  oncloserequest,
  closeLabel = "Close",
  dirtyLabel = "Unsaved changes",
  busyLabel = "Running",
  emptyLabel = "No open documents",
  children,
  className
}) {
  const s = workspaceTabsAppearance(), uid = useId(), root = useRef(null), focus = useRef(null);
  const [local, setLocal] = useState(null);
  const documents = workspaceTabs(items), active = workspaceSelection(
    documents,
    selected === void 0 ? local : selected
  );
  const select = (id) => {
    if (typeof id !== "string" || id === active) return;
    if (selected === void 0) setLocal(id);
    onselectedchange?.(id);
  };
  const requestClose = (id) => {
    const item = documents.find((item2) => item2.id === id);
    if (item && !item.disabled && item.closable !== false) oncloserequest?.(id);
  };
  useEffect(() => {
    const controller = mountWorkspaceFocus(root.current);
    focus.current = controller;
    return () => {
      controller.destroy();
      focus.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    for (const tab of root.current.querySelectorAll(
      '[role="tab"]'
    ))
      tab.disabled = !!documents.find(
        (item) => item.id === tab.dataset.workspaceTab
      )?.disabled;
    focus.current?.sync(documents, active);
  });
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: root,
      "data-workspace-tabs": true,
      className: s.root({ class: className }),
      children: [
        /* @__PURE__ */ jsxs(Managed.Root, { value: active, onValueChange: select, children: [
          /* @__PURE__ */ jsxs(
            "div",
            {
              "data-workspace-scroll": true,
              className: s.frame(),
              style: {
                gridTemplateColumns: `repeat(${Math.max(documents.length, 1)},max-content)`
              },
              children: [
                /* @__PURE__ */ jsx(
                  Managed.List,
                  {
                    "aria-label": label,
                    activateOnFocus: true,
                    className: s.list(),
                    onKeyDown: (event) => {
                      if (event.key !== "Delete" || !(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab")
                        return;
                      const id = event.target.dataset.workspaceTab;
                      if (id && oncloserequest) {
                        event.preventDefault();
                        requestClose(id);
                      }
                    },
                    children: documents.map((item) => /* @__PURE__ */ jsxs(
                      Managed.Tab,
                      {
                        value: item.id,
                        disabled: item.disabled,
                        "data-workspace-item": item.id,
                        "data-workspace-tab": item.id,
                        "aria-label": `${item.label}${item.busy ? `, ${busyLabel}` : ""}`,
                        "aria-describedby": item.dirty || item.busy ? `${uid}-${encodeURIComponent(item.id)}-status` : void 0,
                        className: quietControl({
                          ink: "foreground",
                          class: s.trigger({
                            withClose: !!oncloserequest && item.closable !== false
                          })
                        }),
                        children: [
                          /* @__PURE__ */ jsx("span", { children: item.label }),
                          (item.dirty || item.busy) && /* @__PURE__ */ jsxs(Fragment, { children: [
                            /* @__PURE__ */ jsxs("span", { className: s.status(), "aria-hidden": "true", children: [
                              item.dirty ? "\u2022" : "",
                              item.busy ? ` ${busyLabel}` : ""
                            ] }),
                            /* @__PURE__ */ jsx(
                              "span",
                              {
                                id: `${uid}-${encodeURIComponent(item.id)}-status`,
                                className: "sr-only",
                                children: [
                                  item.dirty ? dirtyLabel : "",
                                  item.busy ? busyLabel : ""
                                ].filter(Boolean).join(", ")
                              }
                            )
                          ] })
                        ]
                      },
                      item.id
                    ))
                  }
                ),
                documents.map(
                  (item, index) => oncloserequest && item.closable !== false && /* @__PURE__ */ jsx(
                    "div",
                    {
                      "data-workspace-item": item.id,
                      className: s.close(),
                      style: { gridColumn: index + 1 },
                      children: /* @__PURE__ */ jsx(
                        Button,
                        {
                          size: "sm",
                          variant: "ghost",
                          disabled: item.disabled,
                          tabIndex: active === item.id ? 0 : -1,
                          className: s.closeButton(),
                          "aria-label": `${closeLabel} ${item.label}`,
                          onClick: () => requestClose(item.id),
                          children: /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\xD7" })
                        }
                      )
                    },
                    item.id
                  )
                )
              ]
            }
          ),
          documents.map((item) => /* @__PURE__ */ jsx(
            Managed.Panel,
            {
              value: item.id,
              keepMounted: true,
              hidden: active !== item.id,
              "data-workspace-panel": item.id,
              className: s.panel(),
              tabIndex: 0,
              children: children?.({ id: item.id })
            },
            item.id
          ))
        ] }),
        !documents.length && /* @__PURE__ */ jsx("p", { className: s.empty(), children: emptyLabel })
      ]
    }
  );
}
var WorkspaceTabs_default = WorkspaceTabs;
export {
  WorkspaceTabs,
  WorkspaceTabs_default as default
};
