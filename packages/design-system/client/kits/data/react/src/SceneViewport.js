"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { operationalView } from "../../src/operational.variants.js";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState
} from "react";
import { sceneViewport } from "../../src/scene-viewport.variants.js";
import {
  mountSceneAnnotations,
  sceneAnnotations
} from "../../src/scene-annotations.js";
import {
  Button,
  quietControl,
  useReducedMotion,
  useControllableValue
} from "@reddb-io/design-system/base";
import { PanZoomViewport } from "./PanZoomViewport.js";
import { mountSceneCamera, mountSceneEngine } from "../../src/scene-viewport.js";
function SceneViewport(props) {
  const {
    label,
    contentWidth,
    contentHeight,
    size = "md",
    focus = null,
    annotations = [],
    selected = null,
    onannotationselect,
    follow,
    following = false,
    onfollowingchange,
    followLabel = "Follow",
    pauseFollowLabel = "Pause following",
    reducedMotionLabel = "Following is paused for reduced motion.",
    grid = true,
    engine,
    data,
    children,
    className
  } = props;
  const visual = operationalView(), a = sceneViewport(), motion = useReducedMotion();
  const [activeFollowing, changeFollowing] = useControllableValue(
    props.following,
    following
  );
  const setFollowing = (next, reason) => {
    changeFollowing(next);
    onfollowingchange?.(next, reason);
  };
  const labels = sceneAnnotations(annotations);
  const labelLayout = useRef(
    null
  );
  const host = useRef(null), engineHost = useRef(null), renderer = useRef(null), [view, setView] = useState({ x: 0, y: 0, scale: 1 }), [error, setError] = useState(null), [attempt, setAttempt] = useState(0), id = useId();
  useLayoutEffect(() => {
    if (host.current) labelLayout.current = mountSceneAnnotations(host.current);
    return () => {
      labelLayout.current?.destroy();
      labelLayout.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (view) labelLayout.current?.update(view);
  }, [view, annotations, selected]);
  const followChange = useRef(setFollowing);
  followChange.current = setFollowing;
  const camera = useRef(null);
  useEffect(() => {
    if (host.current) camera.current = mountSceneCamera(host.current, setView);
    return () => {
      camera.current?.destroy();
      camera.current = null;
    };
  }, []);
  useEffect(() => {
    const reason = camera.current?.update(
      focus ?? { x: 0, y: 0, width: contentWidth, height: contentHeight },
      follow,
      activeFollowing,
      motion.current
    );
    if (reason) followChange.current(false, reason);
  }, [
    focus,
    contentWidth,
    contentHeight,
    follow,
    activeFollowing,
    motion.current
  ]);
  const latest = useRef(data);
  latest.current = data;
  useEffect(() => {
    if (!engineHost.current || !engine) return;
    setError(null);
    renderer.current = mountSceneEngine(
      engineHost.current,
      engine,
      label,
      latest.current,
      setError
    );
    return () => {
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, [engine, label, attempt]);
  useEffect(() => renderer.current?.update(data), [data]);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: host,
      "data-scene-viewport": true,
      className: visual.scene({ class: className }),
      children: [
        /* @__PURE__ */ jsx(
          PanZoomViewport,
          {
            label,
            contentWidth,
            contentHeight,
            size,
            view,
            onViewChange: setView,
            onnavigate: () => {
              if (activeFollowing) setFollowing(false, "navigate");
            },
            overlay: () => /* @__PURE__ */ jsx("div", { className: a.annotations(), children: labels.map((item) => {
              const content = /* @__PURE__ */ jsxs(Fragment, { children: [
                /* @__PURE__ */ jsx("span", { className: a.label(), children: item.label }),
                item.description && /* @__PURE__ */ jsx("span", { className: a.description(), children: item.description })
              ] });
              const attrs = {
                "data-scene-annotation": item.id,
                "data-x": item.x,
                "data-y": item.y,
                "data-selected": selected === item.id
              };
              return onannotationselect ? /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  hidden: true,
                  ...attrs,
                  "aria-pressed": selected === item.id,
                  className: quietControl({
                    ink: "foreground",
                    class: a.annotation()
                  }),
                  onClick: () => onannotationselect(item.id),
                  children: content
                },
                item.id
              ) : /* @__PURE__ */ jsx("div", { hidden: true, ...attrs, className: a.annotation(), children: content }, item.id);
            }) }),
            children: /* @__PURE__ */ jsxs("div", { className: visual.sceneContent(), children: [
              grid && /* @__PURE__ */ jsxs("svg", { "aria-hidden": "true", className: visual.overlay(), children: [
                /* @__PURE__ */ jsx("defs", { children: /* @__PURE__ */ jsx(
                  "pattern",
                  {
                    id,
                    width: "24",
                    height: "24",
                    patternUnits: "userSpaceOnUse",
                    children: /* @__PURE__ */ jsx("circle", { cx: "1", cy: "1", r: "1", fill: "var(--reddb-color-muted)" })
                  }
                ) }),
                /* @__PURE__ */ jsx("rect", { width: "100%", height: "100%", fill: `url(#${id})` })
              ] }),
              /* @__PURE__ */ jsx("div", { className: visual.staticDrawing(), children }),
              /* @__PURE__ */ jsx(
                "div",
                {
                  ref: engineHost,
                  "data-scene-engine": true,
                  "aria-hidden": "true",
                  className: visual.engine()
                }
              )
            ] })
          }
        ),
        follow !== void 0 && /* @__PURE__ */ jsxs("div", { className: a.followControls(), children: [
          /* @__PURE__ */ jsx(
            Button,
            {
              size: "sm",
              variant: "secondary",
              "aria-pressed": activeFollowing && !motion.current,
              disabled: !follow || motion.current,
              onClick: () => setFollowing(!activeFollowing, "control"),
              children: activeFollowing ? pauseFollowLabel : followLabel
            }
          ),
          motion.current && /* @__PURE__ */ jsx("span", { className: a.note(), children: reducedMotionLabel })
        ] }),
        error && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx("p", { role: "status", className: visual.note(), children: error }),
          /* @__PURE__ */ jsx(Button, { size: "sm", onClick: () => setAttempt((n) => n + 1), children: "Retry renderer" })
        ] })
      ]
    }
  );
}
var SceneViewport_default = SceneViewport;
export {
  SceneViewport,
  SceneViewport_default as default
};
