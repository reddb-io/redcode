import { jsx, jsxs } from "react/jsx-runtime";
import { Avatar, MediaObject } from "@reddb-io/design-system/base";
import { chatMessage } from "../../src/composites/chat-message.variants.js";
function ChatMessage({ author, avatarSrc, avatarFallback, datetime, time, children, actions, className, ...rest }) {
  const styles = chatMessage();
  return /* @__PURE__ */ jsx("article", { ...rest, "data-chat-message": true, "aria-label": rest["aria-label"] ?? `Message from ${author}`, className: styles.root({ class: className }), children: /* @__PURE__ */ jsxs(MediaObject, { media: /* @__PURE__ */ jsx(Avatar, { src: avatarSrc, name: author, fallback: avatarFallback }), contentClass: styles.content(), children: [
    /* @__PURE__ */ jsxs("header", { "data-chat-message-header": true, className: styles.header(), children: [
      /* @__PURE__ */ jsx("span", { "data-chat-message-author": true, className: styles.author(), children: author }),
      /* @__PURE__ */ jsx("time", { dateTime: datetime, className: styles.time(), children: time })
    ] }),
    /* @__PURE__ */ jsx("div", { "data-chat-message-body": true, className: styles.body(), children }),
    actions != null && actions !== false && /* @__PURE__ */ jsx("footer", { "data-chat-message-actions": true, className: styles.actions(), children: actions })
  ] }) });
}
export {
  ChatMessage
};
