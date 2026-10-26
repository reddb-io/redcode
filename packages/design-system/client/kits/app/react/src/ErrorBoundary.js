"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Component } from "react";
import { Button } from "@reddb-io/design-system/base";
import { errorBoundary } from "../../src/error-boundary.variants.js";
class NativeBoundary extends Component {
  state = { failed: false, error: void 0 };
  static getDerivedStateFromError(error) {
    return { failed: true, error };
  }
  componentDidCatch(error, _info) {
    this.props.onfailure?.(error);
  }
  retry = () => {
    this.props.onretry?.();
    this.setState({ failed: false, error: void 0 });
  };
  render() {
    const {
      title = "This section could not be displayed",
      description = "Try again to recover this section.",
      retryLabel = "Try again",
      fallback,
      className,
      children
    } = this.props;
    if (!this.state.failed) return children;
    const s = errorBoundary();
    return /* @__PURE__ */ jsx(
      "section",
      {
        "data-error-boundary": true,
        role: "alert",
        "aria-label": title,
        className: s.root({ class: className }),
        children: fallback ? fallback({ error: this.state.error, retry: this.retry }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx("p", { className: s.title(), children: title }),
          /* @__PURE__ */ jsx("p", { className: s.description(), children: description }),
          /* @__PURE__ */ jsx(Button, { onClick: this.retry, children: retryLabel })
        ] })
      }
    );
  }
}
function ErrorBoundary({
  title = "This section could not be displayed",
  description = "Try again to recover this section.",
  retryLabel = "Try again",
  resetKey,
  ...props
}) {
  return /* @__PURE__ */ jsx(
    NativeBoundary,
    {
      title,
      description,
      retryLabel,
      ...props
    },
    resetKey
  );
}
var ErrorBoundary_default = ErrorBoundary;
export {
  ErrorBoundary,
  ErrorBoundary_default as default
};
