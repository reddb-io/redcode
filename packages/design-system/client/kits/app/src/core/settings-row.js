import { fieldAssociation } from "@reddb-io/design-system/base/recipes";
function settingsRowAssociation(props) {
  const association = fieldAssociation({ id: props.id, help: props.description, error: props.error, required: props.required });
  return { ...association, labelId: `${props.id}-label` };
}
export {
  settingsRowAssociation
};
