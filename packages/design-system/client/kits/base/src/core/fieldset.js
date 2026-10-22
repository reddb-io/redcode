import { fieldAssociation } from "./field.js";
function fieldsetAssociation(options) {
  const { control: { id, required, ...control }, helpId, errorId } = fieldAssociation(options);
  return { control, helpId, errorId };
}
export {
  fieldsetAssociation
};
