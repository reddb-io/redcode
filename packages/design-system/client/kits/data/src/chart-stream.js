function createChartStream(options = {}) {
  const { maxPoints = 600, windowMs, intervalMs = 100 } = options;
  if (!Number.isInteger(maxPoints) || maxPoints < 1) throw new Error("ChartStream: maxPoints must be a positive integer.");
  if (windowMs !== void 0 && (!Number.isFinite(windowMs) || windowMs <= 0)) throw new Error("ChartStream: windowMs must be finite and positive.");
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error("ChartStream: intervalMs must be finite and nonnegative.");
  const points = /* @__PURE__ */ new Map(), keys = [], listeners = /* @__PURE__ */ new Set();
  let latest = -Infinity, received = 0, dirty = false, paused = false, disposed = false;
  let timer;
  function validate(batch) {
    for (const point of batch) if (!Number.isFinite(+point.x)) throw new Error("ChartStream: observation timestamps must be finite.");
  }
  function receive(batch) {
    for (const point of batch) {
      received++;
      const x = +point.x;
      latest = Math.max(latest, x);
      if (windowMs !== void 0 && x < latest - windowMs) continue;
      if (!points.has(x)) {
        let low = 0, high = keys.length;
        while (low < high) {
          const middle = low + high >>> 1;
          if (keys[middle] < x) low = middle + 1;
          else high = middle;
        }
        keys.splice(low, 0, x);
      }
      points.set(x, { ...point, x: point.x instanceof Date ? /* @__PURE__ */ new Date(+point.x) : point.x });
      while (keys.length > maxPoints || keys.length > 0 && windowMs !== void 0 && keys[0] < latest - windowMs) points.delete(keys.shift());
      dirty = true;
    }
  }
  const initial = options.initial ?? [];
  validate(initial);
  receive(initial);
  const values = () => Object.freeze(keys.map((key) => points.get(key)));
  let snapshot = Object.freeze({ data: values(), paused, revision: 0, received });
  const serverSnapshot = snapshot;
  dirty = false;
  function cancel() {
    if (timer !== void 0) clearTimeout(timer);
    timer = void 0;
  }
  function notify() {
    for (const listener of [...listeners]) if (listeners.has(listener)) listener(snapshot);
  }
  function publish() {
    cancel();
    dirty = false;
    snapshot = Object.freeze({ data: values(), paused, revision: snapshot.revision + 1, received });
    notify();
  }
  function schedule() {
    if (disposed || paused || !dirty || !listeners.size || intervalMs === 0 || timer !== void 0) return;
    timer = setTimeout(() => {
      timer = void 0;
      if (!disposed && !paused && dirty) publish();
    }, intervalMs);
  }
  return {
    upsert(input) {
      if (disposed) return;
      const batch = Array.isArray(input) ? input : [input];
      validate(batch);
      receive(batch);
      schedule();
    },
    reset(batch) {
      if (disposed) return;
      validate(batch);
      points.clear();
      keys.length = 0;
      latest = -Infinity;
      receive(batch);
      dirty = true;
      schedule();
    },
    pause() {
      if (disposed || paused) return;
      paused = true;
      cancel();
      snapshot = Object.freeze({ ...snapshot, paused, revision: snapshot.revision + 1 });
      notify();
    },
    resume() {
      if (disposed || !paused && !dirty) return;
      paused = false;
      publish();
    },
    flush() {
      if (!disposed && !paused && dirty) publish();
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener) {
      if (disposed) {
        listener(snapshot);
        return () => {
        };
      }
      listeners.add(listener);
      listener(snapshot);
      schedule();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) cancel();
      };
    },
    stats: () => ({ buffered: points.size, received }),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      listeners.clear();
      points.clear();
      keys.length = 0;
    }
  };
}
export {
  createChartStream
};
