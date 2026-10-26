"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import { COMFORTABLE_CHART_RHYTHM, observeChartRhythm } from "../../src/chart.js";
import { whenNear } from "../../src/chart-loading.js";
function useChartRhythm(probe) {
  const [rhythm, setRhythm] = useState(COMFORTABLE_CHART_RHYTHM);
  useLayoutEffect(
    () => probe.current ? observeChartRhythm(probe.current, setRhythm) : void 0,
    [probe]
  );
  return rhythm;
}
function useElementBox(element) {
  const [box, setBox] = useState();
  useLayoutEffect(() => {
    if (!element.current) return;
    const node = element.current, read = () => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node), content = {
        width: Math.max(
          0,
          rect.width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
        ),
        height: Math.max(
          0,
          rect.height - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0)
        )
      };
      setBox(
        (previous) => previous?.width === content.width && previous.height === content.height ? previous : content
      );
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [element]);
  return box;
}
function useChartLoading(figure, loading) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded || !figure.current) return;
    if (loading === "eager") {
      setLoaded(true);
      return;
    }
    return whenNear(figure.current, () => setLoaded(true));
  }, [figure, loading, loaded]);
  return loaded;
}
function useChartEngine(wanted, load) {
  const [engine, setEngine] = useState();
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    void load().then((module) => {
      if (alive) setEngine(() => module.default);
    });
    return () => {
      alive = false;
    };
  }, [wanted, load]);
  return engine;
}
export {
  useChartEngine,
  useChartLoading,
  useChartRhythm,
  useElementBox
};
