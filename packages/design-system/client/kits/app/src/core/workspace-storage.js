class MemoryStorage {
  values = /* @__PURE__ */ new Map();
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, value);
  }
  removeItem(key) {
    this.values.delete(key);
  }
}
function scopedStorage(storage, owns) {
  const keys = () => Array.from(
    { length: storage.length },
    (_, index) => storage.key(index)
  ).filter((key) => key !== null && owns(key));
  return {
    get length() {
      return keys().length;
    },
    key(index) {
      return keys()[index] ?? null;
    },
    getItem(key) {
      return owns(key) ? storage.getItem(key) : null;
    },
    setItem(key, value) {
      if (!owns(key))
        throw new Error("Storage key belongs to another workspace");
      storage.setItem(key, value);
    },
    removeItem(key) {
      if (owns(key)) storage.removeItem(key);
    }
  };
}
class WorkspaceSnapshotStore {
  timer = null;
  debounceMs;
  storage;
  key;
  accepts;
  constructor(options) {
    this.storage = options.storage;
    this.key = options.key;
    this.accepts = options.accepts;
    this.debounceMs = options.debounceMs ?? 1e3;
  }
  write(snapshot) {
    try {
      this.storage()?.setItem(this.key, JSON.stringify(snapshot));
    } catch {
    }
  }
  /** Replace the pending snapshot with a debounced write. */
  schedule(snapshot) {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write(snapshot);
    }, this.debounceMs);
  }
  /** Cancel a pending write and persist immediately. */
  flush(snapshot) {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.write(snapshot);
  }
  /** Cancel a pending write without changing the stored snapshot. */
  dispose() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  /** Restore only JSON accepted by the host's snapshot contract. */
  restore() {
    try {
      const raw = this.storage()?.getItem(this.key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      return this.accepts(value) ? value : null;
    } catch {
      return null;
    }
  }
}
export {
  MemoryStorage,
  WorkspaceSnapshotStore,
  scopedStorage
};
