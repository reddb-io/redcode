const FIELD_LAYOUTS = ["stacked", "inline"];
function fieldAssociation({ id, help, error, required }) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const control = {
    id,
    required: required || void 0,
    "aria-describedby": [help ? helpId : void 0, error ? errorId : void 0].filter(Boolean).join(" ") || void 0,
    "aria-invalid": error ? "true" : void 0,
    "aria-errormessage": error ? errorId : void 0
  };
  return { control, helpId, errorId };
}
export {
  FIELD_LAYOUTS,
  fieldAssociation
};
