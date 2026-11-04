import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  Textarea,
  EmptyState,
  StateIllustration,
  quietControl
} from "@reddb-io/design-system/base";
import {
  queueEmptyCompact,
  searchEmpty
} from "@reddb-io/design-system/base/illustrations";
import { Table } from "./Table.js";
import {
  filterQueueMessages,
  queueSummary,
  queuePayload,
  displayQueueValue,
  queueEventTime,
  queueEmptyReason,
  queueEmptyCopy
} from "../../src/queue-explorer.js";
import { explorerClasses as styles } from "../../src/diff-explorer.variants.js";
function QueueExplorer({
  label,
  messages,
  events,
  commands = [],
  context,
  error,
  onenqueue,
  className = ""
}) {
  const [mode, setMode] = useState("events"), [filter, setFilter] = useState(""), [selected, setSelected] = useState(null), [composer, setComposer] = useState(false), [payload, setPayload] = useState(""), [busy, setBusy] = useState(false), [failure, setFailure] = useState(null), [inserted, setInserted] = useState(0);
  const input = useRef(null), root = useRef(null), controller = useRef(void 0);
  useEffect(() => {
    controller.current?.abort();
    setPayload("");
    setFailure(null);
    setBusy(false);
    setInserted(0);
    setSelected(null);
    return () => controller.current?.abort();
  }, [context]);
  const filtered = filterQueueMessages(messages, filter), summary = queueSummary(messages), ids = new Set(filtered.map((message) => message.id)), visibleEvents = events.filter((event) => ids.has(event.messageId)), active = filtered.find((message) => message.index === selected), reason = queueEmptyReason(
    messages.length,
    filtered.length,
    visibleEvents.length,
    mode
  );
  const rows = visibleEvents.map((event, id) => ({ ...event, id }));
  const columns = [
    { key: "ts", header: "time", format: queueEventTime },
    { key: "collection", header: "source" },
    { key: "op", header: "op" },
    { key: "entityId", header: "entity" },
    { key: "lsn", header: "lsn", align: "end" },
    { key: "after", header: "after", format: displayQueueValue }
  ];
  function clear() {
    setFilter("");
    setSelected(null);
    input.current?.focus();
  }
  const pendingFocus = useRef(null);
  useLayoutEffect(() => {
    if (pendingFocus.current) {
      root.current?.querySelector(
        `[data-queue-mode="${pendingFocus.current}"]`
      )?.focus();
      pendingFocus.current = null;
    }
  }, [mode]);
  function choose(next) {
    pendingFocus.current = next;
    setMode(next);
  }
  async function enqueue() {
    if (!onenqueue || !payload.trim() || busy) return;
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setFailure(null);
    try {
      await onenqueue(queuePayload(payload), task.signal);
      if (task.signal.aborted) return;
      setPayload("");
      setInserted((value) => value + 1);
    } catch (cause) {
      if (!task.signal.aborted)
        setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === task && !task.signal.aborted) setBusy(false);
    }
  }
  return /* @__PURE__ */ jsx(
    "section",
    {
      ref: root,
      "data-queue-explorer": true,
      "aria-label": label,
      className: `@container ${styles.root} ${className}`,
      children: error ? /* @__PURE__ */ jsx("p", { role: "alert", className: styles.detail, children: error }) : /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs("div", { className: styles.toolbar, children: [
          ["events", "messages", "commands", "json"].map((view) => /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              "data-queue-mode": view,
              className: quietControl({
                selected: mode === view,
                class: "px-[var(--reddb-spatial-inset-sm)]"
              }),
              "aria-pressed": mode === view,
              onClick: () => setMode(view),
              children: view
            },
            view
          )),
          /* @__PURE__ */ jsx(
            Button,
            {
              disabled: !onenqueue,
              "aria-pressed": composer,
              onClick: () => setComposer(!composer),
              children: "insert"
            }
          ),
          /* @__PURE__ */ jsxs("label", { children: [
            "Filter queue messages",
            " ",
            /* @__PURE__ */ jsx(
              Input,
              {
                "data-queue-filter": true,
                "aria-label": "Filter queue messages",
                value: filter,
                onChange: (e) => setFilter(e.currentTarget.value),
                ref: input
              }
            )
          ] }),
          filter && /* @__PURE__ */ jsx(Button, { onClick: clear, children: "Clear queue filter" }),
          /* @__PURE__ */ jsxs("span", { children: [
            filtered.length,
            " messages \xB7 ",
            visibleEvents.length,
            " events \xB7",
            " ",
            summary.activeConsumers,
            " active consumers",
            context ? ` \xB7 ${context}` : ""
          ] }),
          summary.sources.length > 0 && /* @__PURE__ */ jsxs("span", { children: [
            "from ",
            summary.sources.join(", ")
          ] }),
          summary.dlcs.length > 0 && /* @__PURE__ */ jsxs("span", { children: [
            "dlc ",
            summary.dlcs.join(", ")
          ] })
        ] }),
        composer && /* @__PURE__ */ jsxs(
          "form",
          {
            className: styles.toolbar,
            onSubmit: (e) => {
              e.preventDefault();
              void enqueue();
            },
            children: [
              /* @__PURE__ */ jsxs("label", { children: [
                "Message payload",
                " ",
                /* @__PURE__ */ jsx(
                  Textarea,
                  {
                    "aria-label": "Message payload",
                    value: payload,
                    onChange: (e) => setPayload(e.currentTarget.value)
                  }
                )
              ] }),
              /* @__PURE__ */ jsx(
                Button,
                {
                  type: "submit",
                  disabled: busy || !onenqueue || !payload.trim(),
                  children: busy ? "Inserting\u2026" : "Insert message"
                }
              ),
              failure ? /* @__PURE__ */ jsx("p", { role: "alert", children: failure }) : inserted > 0 ? /* @__PURE__ */ jsxs("p", { role: "status", children: [
                inserted,
                " inserted. Refresh the collection to reload messages."
              ] }) : null
            ]
          }
        ),
        reason ? /* @__PURE__ */ jsx(
          "div",
          {
            "data-renderer-empty": "queue",
            "data-empty-reason": reason,
            className: styles.detail,
            children: /* @__PURE__ */ jsx(
              EmptyState,
              {
                title: queueEmptyCopy[reason].title,
                description: queueEmptyCopy[reason].description,
                bordered: false,
                media: /* @__PURE__ */ jsx(
                  StateIllustration,
                  {
                    art: reason === "filtered" ? searchEmpty : queueEmptyCompact,
                    size: "md"
                  }
                ),
                actions: reason === "filtered" ? /* @__PURE__ */ jsx(Button, { onClick: clear, children: "Clear queue filter" }) : reason === "unsupported" ? /* @__PURE__ */ jsx(Button, { onClick: () => choose("messages"), children: "View messages" }) : commands.length > 0 ? /* @__PURE__ */ jsx(Button, { onClick: () => choose("commands"), children: "View queue commands" }) : void 0
              }
            )
          }
        ) : mode === "events" ? /* @__PURE__ */ jsx(
          Table,
          {
            caption: context ? `${context} events` : "Queue events",
            captionHidden: true,
            columns,
            rows,
            rowKey: "id",
            pageSize: 80,
            columnVisibility: false
          }
        ) : mode === "commands" ? /* @__PURE__ */ jsxs("div", { className: styles.detail, children: [
          commands.map((command) => /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("p", { children: [
              command.label,
              " \xB7",
              " ",
              command.mutates ? "mutates" : "read-only"
            ] }),
            /* @__PURE__ */ jsx("pre", { className: styles.value, children: command.query }),
            /* @__PURE__ */ jsx("p", { children: command.note })
          ] }, command.query)),
          !commands.length && /* @__PURE__ */ jsx("p", { children: "No queue commands provided." })
        ] }) : mode === "json" ? /* @__PURE__ */ jsx("pre", { className: styles.raw, children: JSON.stringify(
          filtered.map((message) => message.values),
          null,
          2
        ) }) : /* @__PURE__ */ jsxs("div", { className: styles.content, children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              className: styles.list,
              role: "region",
              "aria-label": "Messages",
              tabIndex: 0,
              children: filtered.map((message) => /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  className: quietControl({
                    selected: active?.index === message.index,
                    focus: "inset",
                    class: styles.row
                  }),
                  "aria-pressed": active?.index === message.index,
                  onClick: () => setSelected(message.index),
                  children: [
                    /* @__PURE__ */ jsx("span", { children: message.id }),
                    /* @__PURE__ */ jsx("span", { children: message.state }),
                    /* @__PURE__ */ jsx("span", { children: message.consumer ?? "" }),
                    /* @__PURE__ */ jsx("span", { className: "min-w-0 truncate", children: displayQueueValue(message.message) })
                  ]
                },
                message.index
              ))
            }
          ),
          /* @__PURE__ */ jsx(
            "div",
            {
              className: styles.detail,
              role: "region",
              "aria-label": "Message details",
              tabIndex: 0,
              children: active ? /* @__PURE__ */ jsxs(Fragment, { children: [
                /* @__PURE__ */ jsxs("p", { children: [
                  active.id,
                  " \xB7 ",
                  active.state
                ] }),
                /* @__PURE__ */ jsxs("p", { children: [
                  "consumer ",
                  active.consumer ?? "none",
                  " \xB7 dlc",
                  " ",
                  active.dlc ?? "none"
                ] }),
                /* @__PURE__ */ jsx("pre", { className: styles.value, children: displayQueueValue(active.message) })
              ] }) : /* @__PURE__ */ jsx("p", { children: "Select a message to inspect payload, delivery state, consumer, and DLC link." })
            }
          )
        ] }),
        /* @__PURE__ */ jsx("div", { className: styles.toolbar, children: [...summary.states, ...summary.operations].map(
          ([state, count], index) => /* @__PURE__ */ jsxs("span", { children: [
            state,
            " ",
            count
          ] }, index)
        ) })
      ] })
    }
  );
}
var QueueExplorer_default = QueueExplorer;
export {
  QueueExplorer,
  QueueExplorer_default as default
};
