function createWorkspaceExecution() {
  const active = /* @__PURE__ */ new Map();
  return {
    async run(id, execute, handlers) {
      if (active.has(id)) return false;
      const controller = new AbortController();
      active.set(id, controller);
      try {
        const result = await execute(controller.signal);
        if (active.get(id) === controller) handlers.success(result);
      } catch (error) {
        if (active.get(id) === controller && !controller.signal.aborted) handlers.failure(error);
      } finally {
        if (active.get(id) === controller) {
          active.delete(id);
          handlers.finish();
        }
      }
      return true;
    },
    cancel(id) {
      const controller = active.get(id);
      if (!controller) return false;
      active.delete(id);
      controller.abort();
      return true;
    },
    clear() {
      const controllers = [...active.values()];
      active.clear();
      for (const controller of controllers) controller.abort();
    }
  };
}
export {
  createWorkspaceExecution
};
