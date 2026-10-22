function createConfirmationSession(changed) {
  let generation = 0, pending = false;
  return {
    reset() {
      generation++;
      pending = false;
      changed(false);
    },
    confirm(action, commit) {
      if (pending) return;
      const ticket = ++generation;
      pending = true;
      changed(true);
      const finish = (accepted) => {
        if (ticket !== generation) return;
        pending = false;
        changed(false);
        if (accepted) commit();
      };
      try {
        const result = action();
        if (result && typeof result.then === "function") {
          return Promise.resolve(result).then(() => finish(true), () => finish(false));
        }
        finish(true);
      } catch {
        finish(false);
      }
    }
  };
}
export {
  createConfirmationSession
};
