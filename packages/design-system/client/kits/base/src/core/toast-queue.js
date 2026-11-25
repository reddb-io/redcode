function toastRole(tone) {
  return tone === "danger" || tone === "warning" ? "alert" : "status";
}
function createToastQueue(options = {}) {
  const max = Math.max(1, options.max ?? 3);
  const fallback = options.duration ?? 6e3;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle));
  const now = options.now ?? (() => Date.now());
  let toasts = [];
  let sequence = 0;
  let paused = false;
  const timers = /* @__PURE__ */ new Map();
  const remaining = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  let visible = [];
  const shown = () => toasts.slice(0, max);
  const notify = () => {
    visible = shown();
    for (const listener of listeners) listener(visible);
  };
  function stop(id) {
    const timer = timers.get(id);
    if (timer) cancel(timer.handle);
    timers.delete(id);
  }
  function start(toast, delay = toast.duration) {
    stop(toast.id);
    if (delay === null || paused) {
      if (delay !== null) remaining.set(toast.id, delay);
      return;
    }
    remaining.delete(toast.id);
    const handle = schedule(() => queue.dismiss(toast.id), delay);
    timers.set(toast.id, { handle, deadline: now() + delay });
  }
  function arm() {
    for (const toast of shown()) {
      if (!timers.has(toast.id)) start(toast, remaining.get(toast.id) ?? toast.duration);
    }
  }
  const queue = {
    push(input) {
      const id = input.id ?? `toast-${++sequence}`;
      const toast = {
        id,
        tone: input.tone ?? "neutral",
        title: input.title,
        description: input.description,
        action: input.action,
        duration: input.duration !== void 0 ? input.duration : input.action ? null : fallback
      };
      const index = toasts.findIndex((candidate) => candidate.id === id);
      if (index >= 0) {
        toasts = toasts.map((candidate, at) => at === index ? toast : candidate);
        stop(id);
        remaining.delete(id);
      } else {
        toasts = [...toasts, toast];
      }
      arm();
      notify();
      return id;
    },
    dismiss(id) {
      if (!toasts.some((toast) => toast.id === id)) return;
      stop(id);
      remaining.delete(id);
      toasts = toasts.filter((toast) => toast.id !== id);
      arm();
      notify();
    },
    clear() {
      for (const id of timers.keys()) stop(id);
      remaining.clear();
      toasts = [];
      notify();
    },
    pause() {
      if (paused) return;
      paused = true;
      const at = now();
      for (const [id, timer] of timers) {
        remaining.set(id, Math.max(0, timer.deadline - at));
        cancel(timer.handle);
      }
      timers.clear();
    },
    resume() {
      if (!paused) return;
      paused = false;
      arm();
    },
    snapshot: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      listener(visible);
      return () => listeners.delete(listener);
    }
  };
  return queue;
}
export {
  createToastQueue,
  toastRole
};
