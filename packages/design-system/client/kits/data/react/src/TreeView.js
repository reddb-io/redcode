"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import {
  quietControl,
  useControllableValue
} from "@reddb-io/design-system/base";
import {
  flattenTree,
  findTreeNode,
  treeContains,
  treeDropPosition
} from "../../src/tree.js";
import { buildPathTree } from "../../src/tree.js";
function TreeView(props) {
  const {
    label,
    nodes,
    expanded: controlledExpanded,
    onExpandedChange,
    selected: controlledSelected,
    onSelectedChange,
    renamable = true,
    onRename,
    reorderable = true,
    onReorder,
    leading,
    trailing,
    className = ""
  } = props;
  const [expanded, setExpandedValue] = useControllableValue(
    controlledExpanded,
    [],
    onExpandedChange
  ), [selected, setSelected] = useControllableValue(
    controlledSelected,
    null,
    onSelectedChange
  ), [activeId, setActiveId] = useState(null), [renamingId, setRenamingId] = useState(null), [renameDraft, setRenameDraft] = useState("");
  const tree = useRef(null), editor = useRef(null), renameSession = useRef(null), draft = useRef(""), dragged = useRef(null), typeahead = useRef(""), typeaheadTimer = useRef(
    void 0
  ), expandedIds = new Set(expanded), visible = flattenTree(nodes, expandedIds);
  useEffect(() => {
    if (!visible.some((entry) => entry.node.id === activeId))
      setActiveId(visible[0]?.node.id ?? null);
  }, [nodes, controlledExpanded, expanded, activeId]);
  useEffect(
    () => () => {
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    },
    []
  );
  useLayoutEffect(() => {
    if (renamingId) {
      editor.current?.focus();
      editor.current?.select();
    }
  }, [renamingId]);
  const expand = (id, open) => setExpandedValue(
    open ? [...expanded.filter((candidate) => candidate !== id), id] : expanded.filter((candidate) => candidate !== id)
  );
  const canRename = (node) => !!onRename && (typeof renamable === "function" ? renamable(node) : renamable), canReorder = (node) => !!onReorder && (typeof reorderable === "function" ? reorderable(node) : reorderable);
  function focus(id) {
    setActiveId(id);
    [...tree.current?.querySelectorAll("[data-tree-id]") ?? []].find((item) => item.dataset.treeId === id)?.focus();
  }
  function beginRename(node) {
    if (!canRename(node)) return;
    renameSession.current = node.id;
    draft.current = node.label;
    setActiveId(node.id);
    setRenamingId(node.id);
    setRenameDraft(node.label);
  }
  function finishRename(node, commit) {
    if (renameSession.current !== node.id) return;
    renameSession.current = null;
    setRenamingId(null);
    const next = draft.current.trim();
    if (commit && next && next !== node.label) onRename?.(node, next);
    setTimeout(() => focus(node.id), 0);
  }
  function renameKey(event, node) {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      finishRename(node, event.key === "Enter");
    }
  }
  function source(event) {
    return dragged.current || event.dataTransfer?.getData("text/plain") || null;
  }
  function canDrop(id, target) {
    if (!id || id === target.id || !canReorder(target)) return false;
    const item = findTreeNode(nodes, id);
    return !!item && !treeContains(item, target.id);
  }
  function dragStart(event, node) {
    if (!canReorder(node)) return;
    dragged.current = node.id;
    event.dataTransfer.setData("text/plain", node.id);
    event.dataTransfer.effectAllowed = "move";
  }
  function dragOver(event, node) {
    if (!canDrop(source(event), node)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
  function drop(event, node) {
    const sourceId = source(event);
    if (!canDrop(sourceId, node)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onReorder?.({
      sourceId,
      targetId: node.id,
      position: treeDropPosition(node, event.clientY - rect.top, rect.height)
    });
    dragged.current = null;
  }
  function keydown(event, entry) {
    if (event.target !== event.currentTarget) return;
    const { node, parentId } = entry, children = node.children.length > 0, open = expandedIds.has(node.id), index = visible.indexOf(entry);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const destination = visible[Math.min(
        visible.length - 1,
        Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1))
      )];
      if (destination) focus(destination.node.id);
    } else if (event.key === "Home") focus(visible[0].node.id);
    else if (event.key === "End") focus(visible.at(-1).node.id);
    else if (event.key === "ArrowRight") {
      if (children && !open) expand(node.id, true);
      else if (children) focus(node.children[0].id);
      else return;
    } else if (event.key === "ArrowLeft") {
      if (children && open) expand(node.id, false);
      else if (parentId) focus(parentId);
      else return;
    } else if (event.key === "Enter" || event.key === " ") setSelected(node.id);
    else if (event.key === "F2" && canRename(node)) beginRename(node);
    else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey && event.key !== " ") {
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      typeahead.current += event.key.toLocaleLowerCase();
      typeaheadTimer.current = setTimeout(() => typeahead.current = "", 500);
      const candidates = [
        ...visible.slice(index + 1),
        ...visible.slice(0, index + 1)
      ], match = candidates.find(
        (candidate) => candidate.node.label.toLocaleLowerCase().startsWith(typeahead.current)
      );
      if (match) focus(match.node.id);
    } else return;
    event.preventDefault();
  }
  return /* @__PURE__ */ jsx(
    "ul",
    {
      ref: tree,
      role: "tree",
      "aria-label": label,
      "data-tree-view": true,
      className: `m-0 grid list-none gap-[var(--reddb-spatial-gap-sm)] p-0 text-sm text-foreground ${className}`.trim(),
      children: visible.map((entry) => /* @__PURE__ */ jsx(
        "li",
        {
          role: "treeitem",
          "aria-expanded": entry.node.children.length ? expandedIds.has(entry.node.id) : void 0,
          "aria-selected": selected === entry.node.id,
          "aria-level": entry.level,
          "aria-posinset": entry.position,
          "aria-setsize": entry.setSize,
          tabIndex: activeId === entry.node.id ? 0 : -1,
          "data-tree-id": entry.node.id,
          "data-tree-reorderable": canReorder(entry.node) ? "" : void 0,
          draggable: canReorder(entry.node),
          className: "cursor-default rounded-sm px-[var(--reddb-spatial-inset-sm)] py-[var(--reddb-spatial-gap-sm)] hover:bg-foreground/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-selected:bg-foreground/10 aria-selected:font-medium",
          style: {
            paddingInlineStart: `calc(var(--reddb-spatial-inset-sm) + ${entry.level - 1} * var(--reddb-spatial-inset-md))`
          },
          onClick: (event) => {
            setActiveId(entry.node.id);
            setSelected(entry.node.id);
            event.currentTarget.focus();
          },
          onKeyDown: (event) => keydown(event, entry),
          onDragStart: (event) => dragStart(event, entry.node),
          onDragOver: (event) => dragOver(event, entry.node),
          onDrop: (event) => drop(event, entry.node),
          onDragEnd: () => dragged.current = null,
          children: /* @__PURE__ */ jsxs("span", { className: "flex min-w-0 items-center gap-[var(--reddb-spatial-gap-sm)]", children: [
            canReorder(entry.node) && /* @__PURE__ */ jsx(
              "span",
              {
                "data-tree-drag-handle": true,
                "aria-hidden": "true",
                title: `Drag ${entry.node.label} to reorder`,
                className: "cursor-grab text-ink-muted",
                children: "\u22EE\u22EE"
              }
            ),
            /* @__PURE__ */ jsx(
              "span",
              {
                "aria-hidden": "true",
                className: "inline-block w-[1em] shrink-0 text-ink-muted",
                children: entry.node.children.length ? expandedIds.has(entry.node.id) ? "\u25BE" : "\u25B8" : ""
              }
            ),
            renamingId === entry.node.id ? /* @__PURE__ */ jsx(
              "input",
              {
                ref: editor,
                "data-tree-rename": entry.node.id,
                "aria-label": `Edit name for ${entry.node.label}`,
                value: renameDraft,
                onChange: (event) => {
                  draft.current = event.currentTarget.value;
                  setRenameDraft(event.currentTarget.value);
                },
                onKeyDown: (event) => renameKey(event, entry.node),
                onBlur: () => finishRename(entry.node, true),
                onClick: (event) => event.stopPropagation(),
                className: "min-w-0 flex-1 rounded-sm border border-muted bg-background px-[var(--reddb-spatial-inset-sm)] text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              }
            ) : /* @__PURE__ */ jsxs(Fragment, { children: [
              leading && /* @__PURE__ */ jsx(
                "span",
                {
                  className: "flex shrink-0 items-center",
                  "data-tree-leading": true,
                  children: leading(entry.node)
                }
              ),
              /* @__PURE__ */ jsx("span", { className: "min-w-0 flex-1 truncate", children: entry.node.label }),
              trailing && /* @__PURE__ */ jsx(
                "span",
                {
                  className: "flex shrink-0 items-center",
                  "data-tree-trailing": true,
                  children: trailing(entry.node)
                }
              ),
              canRename(entry.node) && /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  "aria-label": `Rename ${entry.node.label}`,
                  "data-tree-rename-action": true,
                  className: quietControl({
                    class: "rounded-sm px-[var(--reddb-spatial-gap-sm)]"
                  }),
                  onClick: (event) => {
                    event.stopPropagation();
                    beginRename(entry.node);
                  },
                  children: "Rename"
                }
              )
            ] })
          ] })
        },
        entry.node.id
      ))
    }
  );
}
var TreeView_default = TreeView;
export {
  TreeView,
  buildPathTree,
  TreeView_default as default
};
