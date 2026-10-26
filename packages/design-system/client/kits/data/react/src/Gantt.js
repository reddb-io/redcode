"use client";
import { Fragment, jsx } from "react/jsx-runtime";
import { useControllableValue } from "@reddb-io/design-system/base";
import Plot from "./IntervalPlot.js";
function Gantt(props) {
  const {
    data,
    label = "Schedule",
    description,
    width,
    height,
    size,
    selected: initialSelected = "",
    onSelectedChange,
    interactive = true,
    detailHref,
    className = "",
    timeDomain,
    formatTime,
    formatDuration,
    collapsed: initialCollapsed = [],
    onCollapsedChange,
    markers = [],
    windows = [],
    showDetails = true
  } = props;
  const [selected, setSelected] = useControllableValue(
    props.selected,
    initialSelected,
    props.onSelectedChange
  );
  const [collapsed, setCollapsed] = useControllableValue(
    props.collapsed,
    initialCollapsed,
    props.onCollapsedChange
  );
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Plot,
    {
      markers,
      windows,
      showDetails,
      kind: "Gantt",
      data,
      label,
      description,
      width,
      height,
      size,
      selected,
      onSelectedChange: setSelected,
      interactive,
      detailHref,
      className,
      timeDomain,
      formatTime,
      formatDuration,
      collapsed,
      onCollapsedChange: setCollapsed
    }
  ) });
}
var Gantt_default = Gantt;
export {
  Gantt,
  Gantt_default as default
};
