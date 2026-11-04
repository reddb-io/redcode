import { jsx, jsxs } from "react/jsx-runtime";
import { Heading, StateIllustration } from "@reddb-io/design-system/base";
import { operationComplete, operationFailed } from "@reddb-io/design-system/base/illustrations";
import { outcomeScreen } from "../../src/outcome-screen.variants.js";
function OutcomeScreen({ outcome, title, description, note, fullPage = true, headingLevel = 1, illustration, identity, actions, className }) {
  const styles = outcomeScreen({ fullPage });
  const art = illustration ?? (outcome === "success" ? operationComplete : operationFailed);
  return /* @__PURE__ */ jsx("section", { "data-outcome-screen": true, "data-outcome": outcome, "aria-label": title, className: styles.root({ class: className }), children: /* @__PURE__ */ jsxs("div", { className: styles.content(), children: [
    identity && /* @__PURE__ */ jsx("div", { className: styles.identity(), children: identity }),
    /* @__PURE__ */ jsx(StateIllustration, { art, size: "lg" }),
    /* @__PURE__ */ jsx(Heading, { level: headingLevel, role: "title", children: title }),
    description && /* @__PURE__ */ jsx("p", { className: styles.description(), children: description }),
    actions && /* @__PURE__ */ jsx("div", { className: styles.actions(), children: actions }),
    note && /* @__PURE__ */ jsx("p", { className: styles.note(), children: note })
  ] }) });
}
export {
  OutcomeScreen
};
