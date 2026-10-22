function isDropdownMenuGroup(entry) {
  return Array.isArray(entry.items);
}
function dropdownMenuGroups(entries) {
  const groups = [];
  let run;
  for (const entry of entries) {
    if (isDropdownMenuGroup(entry)) {
      run = void 0;
      if (entry.items.length > 0) groups.push(entry);
      continue;
    }
    if (run === void 0) {
      run = [];
      groups.push({ items: run });
    }
    run.push(entry);
  }
  return groups;
}
function dropdownMenuItems(entries) {
  return dropdownMenuGroups(entries).flatMap((group) => [...group.items]);
}
export {
  dropdownMenuGroups,
  dropdownMenuItems,
  isDropdownMenuGroup
};
