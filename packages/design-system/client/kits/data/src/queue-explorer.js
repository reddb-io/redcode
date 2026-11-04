function queueSummary(messages) {
  const active = /* @__PURE__ */ new Set();
  const states = /* @__PURE__ */ new Map();
  const dlcs = /* @__PURE__ */ new Set();
  const operations = /* @__PURE__ */ new Map();
  const sources = /* @__PURE__ */ new Set();
  for (const msg of messages) {
    states.set(msg.state, (states.get(msg.state) ?? 0) + 1);
    if (msg.consumer && /active|leased|processing|running/i.test(msg.state))
      active.add(msg.consumer);
    if (msg.dlc) dlcs.add(msg.dlc);
    if (msg.message && typeof msg.message === "object" && !Array.isArray(msg.message)) {
      const payload = msg.message;
      const op = payload.op;
      const source = payload.collection;
      if (typeof op === "string")
        operations.set(op, (operations.get(op) ?? 0) + 1);
      if (typeof source === "string") sources.add(source);
    }
  }
  return {
    activeConsumers: active.size,
    states: [...states.entries()],
    dlcs: [...dlcs],
    operations: [...operations.entries()].sort(
      (a, b) => a[0].localeCompare(b[0])
    ),
    sources: [...sources].sort()
  };
}
function filterQueueMessages(messages, filter) {
  const term = filter.trim().toLowerCase();
  return messages.filter(
    (message) => !term || message.id.toLowerCase().includes(term) || message.state.toLowerCase().includes(term) || displayQueueValue(message.message).toLowerCase().includes(term)
  );
}
function queuePayload(text) {
  try {
    return JSON.parse(text.trim());
  } catch {
    return text.trim();
  }
}
function displayQueueValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value) ?? "";
}
function queueEventTime(value) {
  if (typeof value !== "number") return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").slice(0, 19) : String(value);
}
function queueEmptyReason(total, filtered, events, mode) {
  if (mode === "commands") return null;
  if (!total) return "empty";
  if (!filtered) return "filtered";
  if (mode === "events" && !events) return "unsupported";
  return null;
}
const queueEmptyCopy = {
  empty: {
    title: "No queue messages returned",
    description: "This result contains no messages. The queue may be empty or the query may exclude available messages."
  },
  filtered: {
    title: "No messages match this filter",
    description: "Clear the search to show the returned queue messages."
  },
  unsupported: {
    title: "No event envelopes in these messages",
    description: "Messages were returned without event envelopes. Inspect their message payloads instead."
  }
};
export {
  displayQueueValue,
  filterQueueMessages,
  queueEmptyCopy,
  queueEmptyReason,
  queueEventTime,
  queuePayload,
  queueSummary
};
