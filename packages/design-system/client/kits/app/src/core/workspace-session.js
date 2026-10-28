function createWorkspaceSession(services) {
  const controller = new AbortController();
  const commands = /* @__PURE__ */ new Map();
  const cleanups = /* @__PURE__ */ new Set();
  let disposed = false;
  return {
    services,
    signal: controller.signal,
    get disposed() {
      return disposed;
    },
    on(command, listener) {
      if (disposed) return () => {
      };
      let listeners = commands.get(command);
      if (!listeners) commands.set(command, listeners = /* @__PURE__ */ new Set());
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && commands.get(command) === listeners) commands.delete(command);
      };
    },
    dispatch(command) {
      if (disposed) return;
      const listeners = commands.get(command);
      if (!listeners) return;
      for (const listener of [...listeners]) {
        if (disposed) break;
        if (listeners.has(listener)) listener();
      }
    },
    onDispose(cleanup) {
      if (disposed) {
        cleanup();
        return () => {
        };
      }
      cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      commands.clear();
      controller.abort();
      const errors = [];
      const pending = [...cleanups].reverse();
      cleanups.clear();
      for (const cleanup of pending) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "Workspace cleanup failed");
    }
  };
}
export {
  createWorkspaceSession
};
