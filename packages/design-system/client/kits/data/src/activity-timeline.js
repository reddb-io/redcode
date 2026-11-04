function activityTimelineModel(rows, domain) {
  const rowIds = /* @__PURE__ */ new Set();
  let minimum = Infinity, maximum = -Infinity;
  for (const row of rows) {
    if (!row.id || rowIds.has(row.id)) throw new Error("ActivityTimeline: row ids must be nonempty and unique");
    rowIds.add(row.id);
    const eventIds = /* @__PURE__ */ new Set();
    for (const event of row.events) {
      if (!event.id || eventIds.has(event.id)) throw new Error("ActivityTimeline: event ids must be nonempty and unique within a row");
      eventIds.add(event.id);
      if (!Number.isFinite(event.start) || !Number.isFinite(event.end) || event.end < event.start) throw new Error("ActivityTimeline: event bounds must be finite and increasing");
      if (event.lane !== void 0 && (!Number.isInteger(event.lane) || event.lane < 0 || event.lane > 7)) throw new Error("ActivityTimeline: lane must be an integer from 0 to 7");
      minimum = Math.min(minimum, event.start);
      maximum = Math.max(maximum, event.end);
    }
  }
  if (domain && (!domain.every(Number.isFinite) || domain[0] >= domain[1])) throw new Error("ActivityTimeline: domain must be finite and increasing");
  const low = domain?.[0] ?? (Number.isFinite(minimum) ? minimum : 0);
  let high = domain?.[1] ?? (Number.isFinite(maximum) ? maximum : 1);
  if (high === low) high = low + 1;
  return { domain: [low, high], rows: rows.map((row) => ({ ...row, events: row.events.flatMap((event) => {
    if (event.end < low || event.start > high) return [];
    const start = Math.max(low, event.start), end = Math.min(high, event.end);
    return [{ ...event, left: (start - low) / (high - low) * 100, width: (end - start) / (high - low) * 100, lane: event.lane ?? 0 }];
  }) })) };
}
export {
  activityTimelineModel
};
