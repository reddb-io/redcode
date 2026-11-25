import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const secretValue = tv(
  {
    slots: {
      root: "@container/secret-value w-full grid min-w-0 gap-[var(--reddb-spatial-gap-sm)] text-foreground",
      label: "text-caption font-medium wrap-break-word",
      row: "flex min-w-0 flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]",
      value: (
        // A secret is an opaque token and may break anywhere, but it keeps a
        // usable width: below it the reveal action wraps onto its own line.
        "min-w-0 grow basis-[min(100%,16ch)] whitespace-pre-wrap font-mono text-body wrap-anywhere"
      ),
      error: "m-0 text-caption text-feedback-danger-foreground wrap-break-word"
    }
  },
  typeRoleMerge
);
export {
  secretValue
};
