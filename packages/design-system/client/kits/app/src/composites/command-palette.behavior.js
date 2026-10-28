function commandGroups(commands, query) {
  const normalized = query.trim().toLocaleLowerCase();
  const groups = /* @__PURE__ */ new Map();
  for (const command of commands) {
    if (normalized && ![command.label, command.description, command.group, ...command.keywords ?? []].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized)) continue;
    const key = command.group ?? "";
    const group = groups.get(key) ?? [];
    group.push(command);
    groups.set(key, group);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}
export {
  commandGroups
};
