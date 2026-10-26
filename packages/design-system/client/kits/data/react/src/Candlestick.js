"use client";
import { jsx } from "react/jsx-runtime";
import { useMemo } from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import CompositeChart from "./CompositeChart.js";
function Candlestick(props) {
  const {
    data,
    label,
    activeX: initialActiveX = null,
    overlays = [],
    candleLabel = "OHLC",
    series = 1,
    hiddenSeries: initialHiddenSeries = [],
    expanded: initialExpanded = false,
    onHiddenSeriesChange,
    onExpandedChange,
    ...rest
  } = props;
  const [hiddenSeries, setHiddenSeries] = useControllableValue(props.hiddenSeries, initialHiddenSeries, onHiddenSeriesChange);
  const [expanded, setExpanded] = useControllableValue(props.expanded, initialExpanded, onExpandedChange);
  const layers = useMemo(() => [{ id: "candles", label: candleLabel, kind: "candlestick", data, series }, ...overlays], [data, candleLabel, series, props.overlays]);
  return /* @__PURE__ */ jsx(CompositeChart, { ...rest, activeX: props.activeX === void 0 ? void 0 : initialActiveX, label, data: layers, hiddenSeries, expanded, onHiddenSeriesChange: setHiddenSeries, onExpandedChange: setExpanded });
}
var Candlestick_default = Candlestick;
export {
  Candlestick,
  Candlestick_default as default
};
