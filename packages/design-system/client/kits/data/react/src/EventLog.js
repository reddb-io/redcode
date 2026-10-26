"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button } from "@reddb-io/design-system/base";
import { VirtualList } from "./VirtualList.js";
import {
  retainedEvents,
  followEvents,
  operationalToneInk
} from "../../src/operational.js";
import { operationalView } from "../../src/operational.variants.js";
function EventLog({
  label,
  events,
  limit = 200,
  query = "",
  following = false,
  onfollowingchange,
  emptyLabel = "No matching events",
  className
}) {
  const visual = operationalView();
  const host = useRef(null), controller = useRef(null), previous = useRef(void 0), [suspended, setSuspended] = useState(false), [unread, setUnread] = useState(0), retained = retainedEvents(events, limit, query);
  const pause = useRef(onfollowingchange);
  pause.current = onfollowingchange;
  useEffect(() => {
    const list = host.current?.querySelector(
      "[data-virtual-list]"
    );
    if (list)
      controller.current = followEvents(list, () => {
        setSuspended(true);
        pause.current?.(false);
      });
    return () => {
      controller.current?.destroy();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    controller.current?.update(following && !suspended);
    const last = events.at(-1)?.id;
    if (following && !suspended) setUnread(0);
    else if (previous.current && last !== previous.current) {
      const at = events.findIndex((e) => e.id === previous.current);
      setUnread((n) => n + (at < 0 ? events.length : events.length - at - 1));
    }
    previous.current = last;
  }, [events, following, suspended, query, limit]);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: host,
      "data-event-log": true,
      className: visual.root({ class: className }),
      children: [
        /* @__PURE__ */ jsxs("div", { className: visual.header(), children: [
          /* @__PURE__ */ jsx("p", { className: visual.title(), children: label }),
          onfollowingchange && /* @__PURE__ */ jsx(
            Button,
            {
              size: "sm",
              variant: "ghost",
              onClick: () => {
                const next = !(following && !suspended);
                setSuspended(false);
                setUnread(0);
                onfollowingchange(next);
              },
              children: following && !suspended ? "Pause following" : `Follow latest${unread ? ` (${unread} new)` : ""}`
            }
          )
        ] }),
        retained.discarded > 0 && /* @__PURE__ */ jsxs("p", { className: visual.text(), children: [
          retained.discarded,
          " earlier events outside retention"
        ] }),
        /* @__PURE__ */ jsx(
          VirtualList,
          {
            label,
            items: retained.events,
            rowKey: (event) => event.id,
            rowUnits: 2,
            visibleRows: 6,
            emptyLabel,
            children: (event) => /* @__PURE__ */ jsxs("div", { "data-event-id": event.id, className: visual.eventBody(), children: [
              /* @__PURE__ */ jsxs("div", { className: visual.eventMeta(), children: [
                /* @__PURE__ */ jsx("time", { dateTime: event.datetime, children: event.time }),
                event.source && /* @__PURE__ */ jsx("span", { title: event.source, children: event.source })
              ] }),
              /* @__PURE__ */ jsx(
                "p",
                {
                  className: visual.eventMessage(),
                  title: event.message,
                  style: { color: operationalToneInk(event.tone) },
                  children: event.message
                }
              )
            ] })
          }
        )
      ]
    }
  );
}
var EventLog_default = EventLog;
export {
  EventLog,
  EventLog_default as default
};
