"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import {
  Button,
  quietControl,
  useReducedMotion
} from "@reddb-io/design-system/base";
import {
  terminalAppearance
} from "../../src/terminal-session.js";
import { terminalSession } from "../../src/terminal-session.variants.js";
function TerminalSession(props) {
  const {
    label,
    engine,
    transcript = "",
    rows = 10,
    loading = "lazy",
    readOnly = false,
    onSessionChange,
    onInteraction,
    actions,
    loadingLabel = "Loading terminal\u2026",
    readyLabel = "Terminal ready",
    errorLabel = "The terminal could not be loaded. Your transcript is still available.",
    retryLabel = "Retry terminal",
    transcriptLabel = "Session transcript",
    className
  } = props;
  const styles = terminalSession(), reducedMotion = useReducedMotion(), root = useRef(null), host = useRef(null), [requested, setRequested] = useState(false), [attempt, setAttempt] = useState(0), [phase, setPhase] = useState(
    "idle"
  ), [runtime, setRuntime] = useState(), focusAfterRetry = useRef(false);
  const latest = useRef({
    label,
    readOnly,
    onInteraction,
    onSessionChange,
    reduced: reducedMotion.current
  });
  latest.current = {
    label,
    readOnly,
    onInteraction,
    onSessionChange,
    reduced: reducedMotion.current
  };
  useEffect(() => {
    if (loading === "eager" || typeof IntersectionObserver === "undefined") {
      setRequested(true);
      return;
    }
    if (!root.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRequested(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [loading]);
  useEffect(() => {
    if (!requested || !host.current) return;
    const container = host.current, controller = new AbortController(), notify = latest.current.onSessionChange;
    let instance, announced = false, disposed = false;
    const dispose = () => {
      if (instance && !disposed) {
        disposed = true;
        instance.dispose();
      }
    };
    setPhase("loading");
    void (async () => {
      try {
        const initial = latest.current;
        instance = await engine(container, {
          label: initial.label,
          readOnly: initial.readOnly,
          appearance: terminalAppearance(container, initial.reduced),
          signal: controller.signal,
          input: (data) => {
            if (!controller.signal.aborted && !latest.current.readOnly)
              latest.current.onInteraction?.({ type: "data", data });
          },
          resize: (columns, rows2) => {
            if (!controller.signal.aborted && Number.isInteger(columns) && columns > 0 && Number.isInteger(rows2) && rows2 > 0)
              latest.current.onInteraction?.({ type: "resize", columns, rows: rows2 });
          }
        });
        if (controller.signal.aborted) {
          dispose();
          return;
        }
        const current = latest.current;
        instance.update({
          label: current.label,
          readOnly: current.readOnly,
          appearance: terminalAppearance(container, current.reduced)
        });
        instance.fit();
        setRuntime(instance);
        setPhase("ready");
        announced = true;
        notify?.(instance);
      } catch {
        if (controller.signal.aborted) return;
        controller.abort();
        dispose();
        instance = void 0;
        setRuntime(void 0);
        setPhase("error");
        if (announced) {
          announced = false;
          notify?.(null);
        }
      }
    })();
    return () => {
      controller.abort();
      dispose();
      setRuntime(void 0);
      if (announced) notify?.(null);
    };
  }, [requested, engine, attempt]);
  useLayoutEffect(() => {
    if (phase === "ready" && runtime && focusAfterRetry.current) {
      focusAfterRetry.current = false;
      if (document.activeElement === document.body) runtime.focus();
    }
  }, [phase, runtime]);
  useEffect(() => {
    if (!runtime || !host.current || !root.current) return;
    const container = host.current;
    const refresh = () => {
      runtime.update({
        label,
        appearance: terminalAppearance(container, reducedMotion.current),
        readOnly
      });
      runtime.fit();
    };
    refresh();
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(refresh) : void 0;
    resize?.observe(container);
    const appearance = typeof MutationObserver === "function" ? new MutationObserver(refresh) : void 0;
    for (let scope = root.current; scope; scope = scope.parentElement)
      appearance?.observe(scope, {
        attributes: true,
        attributeFilter: [
          "data-theme",
          "data-color-scheme",
          "data-density",
          "class",
          "style"
        ]
      });
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) refresh();
    });
    return () => {
      active = false;
      resize?.disconnect();
      appearance?.disconnect();
    };
  }, [runtime, label, readOnly, reducedMotion.current]);
  return /* @__PURE__ */ jsxs(
    "section",
    {
      ref: root,
      "data-terminal-session": true,
      "data-phase": phase,
      "aria-label": label,
      className: styles.root({ class: className }),
      children: [
        /* @__PURE__ */ jsxs("header", { className: styles.header(), children: [
          /* @__PURE__ */ jsx("p", { className: styles.title(), children: label }),
          actions != null && actions !== false && /* @__PURE__ */ jsx("div", { className: styles.actions(), children: actions })
        ] }),
        /* @__PURE__ */ jsxs(
          "div",
          {
            className: styles.body(),
            style: {
              height: `calc(var(--reddb-spatial-control-height-md) * ${Math.max(3, Math.min(40, Number.isFinite(rows) ? rows : 10))})`
            },
            children: [
              /* @__PURE__ */ jsx(
                "div",
                {
                  inert: phase !== "ready" || void 0,
                  "aria-hidden": phase !== "ready",
                  className: styles.engine(),
                  children: /* @__PURE__ */ jsx("div", { ref: host, "data-terminal-engine": true, className: styles.mount() })
                }
              ),
              phase !== "ready" && /* @__PURE__ */ jsx(
                "pre",
                {
                  "data-terminal-fallback": true,
                  tabIndex: 0,
                  role: "region",
                  "aria-label": transcriptLabel,
                  className: styles.fallback(),
                  children: transcript
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsxs("div", { className: styles.footer(), children: [
          /* @__PURE__ */ jsx("span", { role: "status", children: phase === "error" ? errorLabel : phase === "ready" ? readyLabel : loadingLabel }),
          phase === "error" && /* @__PURE__ */ jsx(
            Button,
            {
              size: "sm",
              variant: "secondary",
              onClick: (event) => {
                focusAfterRetry.current = event.currentTarget === document.activeElement;
                setAttempt((value) => value + 1);
              },
              children: retryLabel
            }
          )
        ] }),
        phase === "ready" && transcript && /* @__PURE__ */ jsxs("details", { children: [
          /* @__PURE__ */ jsx(
            "summary",
            {
              className: quietControl({
                focus: "inset",
                class: "cursor-pointer p-[var(--reddb-spatial-inset-md)] text-caption"
              }),
              children: transcriptLabel
            }
          ),
          /* @__PURE__ */ jsx("pre", { className: styles.transcript(), children: transcript })
        ] })
      ]
    }
  );
}
var TerminalSession_default = TerminalSession;
export {
  TerminalSession,
  TerminalSession_default as default
};
