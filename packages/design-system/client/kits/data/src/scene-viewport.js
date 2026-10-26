import { fitView } from "./pan-zoom.js";
import { observeActivity } from "@reddb-io/design-system/base";
function focusView(target, viewport) {
  if (![target.x, target.y, target.width, target.height].every(Number.isFinite) || target.width <= 0 || target.height <= 0)
    throw new Error("SceneViewport: focus requires finite positive bounds");
  const fit = fitView(target, viewport, 0.05, 8);
  return {
    ...fit,
    x: fit.x - target.x * fit.scale,
    y: fit.y - target.y * fit.scale
  };
}
function mountSceneCamera(host, changed) {
  const viewport = host.querySelector(
    "[data-pan-zoom] [role=region]"
  );
  let target, overviewKey, followKey, active = false;
  let lastReason;
  const key = (bounds) => [bounds.x, bounds.y, bounds.width, bounds.height].join(",");
  const paint = () => {
    if (!viewport || !target) return;
    const box = viewport.getBoundingClientRect();
    if (box.width && box.height) changed(focusView(target, box));
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(paint) : void 0;
  if (viewport) observer?.observe(viewport);
  return {
    update(overview, follow, following, reducedMotion) {
      const reduced = reducedMotion || Boolean(
        host.ownerDocument.defaultView?.matchMedia?.(
          "(prefers-reduced-motion: reduce)"
        ).matches
      );
      const reason = following ? reduced ? "reduced-motion" : !follow ? "unavailable" : void 0 : void 0;
      const nextActive = Boolean(following && follow && !reduced), nextOverview = key(overview), nextFollow = follow ? key(follow) : void 0;
      if (nextActive && (nextFollow !== followKey || !active || nextOverview !== overviewKey)) {
        target = { ...follow };
        paint();
      } else if (!nextActive && nextOverview !== overviewKey) {
        target = { ...overview };
        paint();
      }
      overviewKey = nextOverview;
      followKey = nextFollow;
      active = nextActive;
      const report = reason !== lastReason ? reason : void 0;
      lastReason = reason;
      return report;
    },
    destroy() {
      observer?.disconnect();
    }
  };
}
function mountSceneEngine(host, factory, label, initial, status) {
  let data = initial, handle, disposed = false, requested = false, active = false;
  const abort = new AbortController();
  const start = () => {
    if (requested || disposed) return;
    requested = true;
    void Promise.resolve().then(
      () => disposed ? null : factory(host, { label, data, signal: abort.signal })
    ).then((engine) => {
      if (!engine) return;
      if (disposed) {
        engine.destroy();
        return;
      }
      handle = engine;
      engine.update(data);
      engine.pause(!active);
      status(null);
    }).catch(() => {
      if (!disposed)
        status(
          "Scene renderer unavailable. The static view remains available."
        );
    });
  };
  const stop = observeActivity(host, (allowed) => {
    active = allowed;
    if (allowed) start();
    if (handle) {
      if (allowed) handle.update(data);
      handle.pause(!allowed);
    }
  });
  return {
    update(next) {
      data = next;
      if (active) handle?.update(data);
    },
    destroy() {
      disposed = true;
      abort.abort();
      stop();
      handle?.destroy();
      host.replaceChildren();
    }
  };
}
export {
  focusView,
  mountSceneCamera,
  mountSceneEngine
};
