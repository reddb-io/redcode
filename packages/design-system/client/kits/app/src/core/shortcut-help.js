function shortcutGroups(groups) {
  const ids = /* @__PURE__ */ new Set();
  for (const group of groups) {
    if (!group.id.trim() || ids.has(group.id))
      throw new Error("ShortcutHelp requires unique group ids.");
    ids.add(group.id);
    const commands = /* @__PURE__ */ new Set();
    for (const item of group.items) {
      if (!item.id.trim() || commands.has(item.id) || !item.keys.length || item.keys.some((key) => !key.trim()))
        throw new Error(
          "ShortcutHelp requires unique command ids and non-empty chords."
        );
      commands.add(item.id);
    }
  }
  return groups.filter((group) => group.items.length);
}
export {
  shortcutGroups
};
