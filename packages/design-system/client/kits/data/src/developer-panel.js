function filterDeveloperRequests(requests, filter) {
  const query = filter.trim().toLocaleLowerCase();
  return requests.filter((request) => [request.method, request.target, request.status, request.source, request.timeLabel].some((value) => value?.toLocaleLowerCase().includes(query)));
}
function formatRequestDuration(value) {
  if (value === void 0 || !Number.isFinite(value) || value < 0) return "Not measured";
  if (value < 1 && value > 0) return "<1 ms";
  if (value < 1e3) return `${Math.round(value)} ms`;
  return `${(value / 1e3).toFixed(2)} s`;
}
function formatRequestDetails(request, view) {
  const lines = [`${request.method} ${request.target} \xB7 ${request.status}`];
  if (view === "headers") {
    lines.push("Response headers:");
    for (const [key, value] of request.responseHeaders ?? []) lines.push(`${key}: ${value}`);
    lines.push("", "Request headers:");
    for (const [key, value] of request.requestHeaders ?? []) lines.push(`${key}: ${value}`);
  } else if (view === "timing") {
    lines.push(`Total: ${formatRequestDuration(request.durationMs)}`);
    for (const phase of request.phases ?? []) lines.push(`${phase.label}: ${formatRequestDuration(phase.durationMs)} (start ${formatRequestDuration(phase.startMs)})`);
    for (const [key, value] of request.connection ?? []) lines.push(`${key}: ${value}`);
  } else {
    const headers = view === "request" ? request.requestHeaders : request.responseHeaders;
    const body = view === "request" ? request.requestBody : request.responseBody;
    if (view === "response" && request.error) lines.push(request.error);
    for (const [key, value] of headers ?? []) lines.push(`${key}: ${value}`);
    if (body !== void 0) lines.push("", body);
  }
  return lines.join("\n");
}
function developerRequestStatusTone(status) {
  const code = /^(\d{3})(?:\s|$)/.exec(status.trim());
  if (!code) return "neutral";
  const value = Number(code[1]);
  if (value >= 500 && value < 600) return "danger";
  if (value >= 400 && value < 500) return "warning";
  if (value >= 300 && value < 400) return "info";
  if (value >= 200 && value < 300) return "success";
  return "neutral";
}
function clampDeveloperPanelHeight(height, available) {
  const limit = Math.max(0, available);
  return Math.min(limit, Math.max(Math.min(160, limit), height));
}
function developerPanelHeightForKey(key, height, available) {
  const step = Math.max(1, available * 0.02);
  if (key === "ArrowUp") return clampDeveloperPanelHeight(height + step, available);
  if (key === "ArrowDown") return clampDeveloperPanelHeight(height - step, available);
  if (key === "Home") return clampDeveloperPanelHeight(available, available);
  if (key === "End") return clampDeveloperPanelHeight(0, available);
  return null;
}
export {
  clampDeveloperPanelHeight,
  developerPanelHeightForKey,
  developerRequestStatusTone,
  filterDeveloperRequests,
  formatRequestDetails,
  formatRequestDuration
};
