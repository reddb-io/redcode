function createInlineEditSession(value, changed) {
  let state = { draft: value, error: "", saving: false };
  let generation = 0;
  const publish = (next) => {
    state = next;
    changed(state);
  };
  return {
    get state() {
      return state;
    },
    invalidate() {
      generation++;
    },
    reset(value2) {
      generation++;
      publish({ draft: value2, error: "", saving: false });
    },
    change(draft) {
      if (!state.saving) publish({ ...state, draft, error: "" });
    },
    async save(options) {
      if (state.saving) return { status: "busy" };
      const candidate = state.draft;
      const error = options.required && !candidate.trim() ? options.requiredMessage : options.validate?.(candidate) ?? "";
      if (error) {
        publish({ ...state, error });
        return { status: "invalid" };
      }
      const ticket = ++generation;
      publish({ ...state, saving: true, error: "" });
      try {
        await options.confirm?.(candidate);
      } catch {
        if (ticket !== generation) return { status: "stale" };
        publish({ ...state, error: options.saveErrorMessage, saving: false });
        return { status: "failed" };
      }
      if (ticket !== generation) return { status: "stale" };
      publish({ ...state, saving: false });
      return { status: "committed", value: candidate };
    }
  };
}
export {
  createInlineEditSession
};
