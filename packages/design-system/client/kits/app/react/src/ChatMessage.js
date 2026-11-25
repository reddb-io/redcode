import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Avatar, Button, MediaObject } from "@reddb-io/design-system/base";
import { chatMessage } from "../../src/composites/chat-message.variants.js";
function ChatMessage({ author, avatarSrc, avatarFallback, datetime, time, speaker = "user", status = "complete", retryLabel = "Retry", cancelledLabel = "Stopped", children, actions, onRetry, className, ...rest }) {
  const styles = chatMessage({ speaker });
  const [announcement, setAnnouncement] = useState("");
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current === "streaming" && status === "complete") setAnnouncement(`${author} finished replying.`);
    previous.current = status;
  }, [status, author]);
  const retry = status === "error" && onRetry;
  return /* @__PURE__ */ jsxs("article", { ...rest, "data-chat-message": true, "data-speaker": speaker, "data-status": status, "aria-label": rest["aria-label"] ?? `Message from ${author}`, "aria-busy": status === "streaming" ? true : void 0, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsxs(MediaObject, { media: /* @__PURE__ */ jsx(Avatar, { src: avatarSrc, name: author, fallback: avatarFallback }), contentClass: styles.content(), children: [
      /* @__PURE__ */ jsxs("header", { "data-chat-message-header": true, className: styles.header(), children: [
        /* @__PURE__ */ jsx("span", { "data-chat-message-author": true, className: styles.author(), children: author }),
        /* @__PURE__ */ jsx("time", { dateTime: datetime, className: styles.time(), children: time })
      ] }),
      /* @__PURE__ */ jsx("div", { "data-chat-message-body": true, className: styles.body(), children }),
      status === "cancelled" && /* @__PURE__ */ jsx("p", { "data-chat-message-note": true, className: styles.note(), children: cancelledLabel }),
      (retry || actions != null && actions !== false) && /* @__PURE__ */ jsxs("footer", { "data-chat-message-actions": true, className: styles.actions(), children: [
        retry && /* @__PURE__ */ jsx(Button, { size: "sm", variant: "secondary", onClick: onRetry, children: retryLabel }),
        actions
      ] })
    ] }),
    /* @__PURE__ */ jsx("span", { role: "status", className: styles.announcement(), children: announcement })
  ] });
}
export {
  ChatMessage
};
