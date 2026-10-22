const TYPE_ROLE_UTILITIES = ["display", "title", "heading", "body", "caption", "eyebrow"];
const typeRoleMerge = {
  twMergeConfig: {
    extend: {
      classGroups: {
        "font-size": [{ text: [...TYPE_ROLE_UTILITIES, "editable-sm", "editable-md", "editable-lg"] }]
      }
    }
  }
};
export {
  TYPE_ROLE_UTILITIES,
  typeRoleMerge
};
