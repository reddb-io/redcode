"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import {
  Fragment as Fragment2,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import {
  variableTokenGrammar
} from "../../src/code-field.js";
export * from "../../src/code-field.js";
function CodeField(props) {
  const {
    label,
    value: initialValue = "",
    onValueChange,
    grammar,
    resolved = [],
    suggestions = [],
    gutter = false,
    rows = 5,
    id,
    name,
    placeholder,
    help,
    required = false,
    disabled = false,
    className = "",
    inputClass = ""
  } = props;
  const [value, setValue] = useControllableValue(
    props.value,
    initialValue,
    onValueChange
  ), uid = useId(), inputId = id ?? `${uid}-input`, helpId = `${uid}-help`, listboxId = `${uid}-suggestions`;
  const inputElement = useRef(
    null
  ), highlightElement = useRef(null), gutterElement = useRef(null), cursor = useRef(null), currentText = useRef(value);
  currentText.current = value;
  const [completion, setCompletion] = useState(
    null
  ), [activeIndex, setActiveIndex] = useState(-1), currentCompletion = useRef(completion), currentIndex = useRef(activeIndex);
  currentCompletion.current = completion;
  currentIndex.current = activeIndex;
  const activeGrammar = grammar ?? variableTokenGrammar(resolved), tokens = activeGrammar.tokenize(value), lineNumbers = Array.from(
    { length: value.split("\n").length },
    (_, index) => index + 1
  ), normalizedSuggestions = suggestions.map(
    (s) => typeof s === "string" ? { value: s, label: s } : s
  );
  const candidates = (session) => session ? normalizedSuggestions.filter(
    (s) => s.value.toLocaleLowerCase().startsWith(session.query.toLocaleLowerCase())
  ) : [];
  const filteredSuggestions = candidates(completion), open = !disabled && completion !== null && filteredSuggestions.length > 0;
  function updateCompletion(next) {
    currentCompletion.current = next;
    currentIndex.current = -1;
    setCompletion(next);
    setActiveIndex(-1);
  }
  function refreshCompletion(element = inputElement.current) {
    const text = currentText.current;
    updateCompletion(
      !element || disabled || !normalizedSuggestions.length ? null : activeGrammar.completionAt?.(
        text,
        element.selectionStart ?? text.length
      ) ?? null
    );
  }
  function syncScroll() {
    const input = inputElement.current, highlight = highlightElement.current;
    if (!input || !highlight) return;
    highlight.scrollLeft = input.scrollLeft;
    highlight.scrollTop = input.scrollTop;
    if (gutterElement.current)
      gutterElement.current.scrollTop = input.scrollTop;
  }
  function handleInput(event) {
    currentText.current = event.currentTarget.value;
    setValue(currentText.current);
    refreshCompletion(event.currentTarget);
    syncScroll();
  }
  function choose(index) {
    const session = currentCompletion.current, suggestion = candidates(session)[index];
    if (disabled || !session || !suggestion || suggestion.disabled) return;
    const text = currentText.current, result = activeGrammar.complete?.(text, session, suggestion.value) ?? {
      value: text.slice(0, session.replaceStart) + suggestion.value + text.slice(session.replaceEnd),
      cursor: session.replaceStart + suggestion.value.length
    };
    currentText.current = result.value;
    cursor.current = result.cursor;
    setValue(result.value);
    updateCompletion(null);
  }
  useLayoutEffect(() => {
    if (cursor.current === null) return;
    inputElement.current?.focus();
    inputElement.current?.setSelectionRange(cursor.current, cursor.current);
    cursor.current = null;
    syncScroll();
  }, [value, completion]);
  useLayoutEffect(() => {
    if (disabled) updateCompletion(null);
  }, [disabled]);
  function handleKeydown(event) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!currentCompletion.current) refreshCompletion(event.currentTarget);
      const options = candidates(currentCompletion.current);
      if (!options.length) return;
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      let next = currentIndex.current;
      for (let count = 0; count < options.length; count++) {
        next = (next + direction + options.length) % options.length;
        if (!options[next]?.disabled) {
          currentIndex.current = next;
          setActiveIndex(next);
          return;
        }
      }
    } else if ((event.key === "Enter" || event.key === "Tab") && currentCompletion.current && currentIndex.current >= 0) {
      event.preventDefault();
      choose(currentIndex.current);
    } else if (event.key === "Escape" && currentCompletion.current) {
      event.preventDefault();
      updateCompletion(null);
    }
  }
  const optionId = (index) => `${uid}-suggestion-${index}`;
  const tokenClass = (kind, state) => state === "resolved" ? "text-[var(--reddb-color-feedback-success-foreground)]" : state === "unresolved" ? "text-[var(--reddb-color-feedback-danger-foreground)] underline decoration-wavy" : kind === "text" ? "text-foreground" : "text-primary-text";
  const controlClass = gutter ? "" : "h-[var(--reddb-spatial-control-height-md)]", paddingClass = gutter ? "py-[var(--reddb-spatial-inset-sm)] pr-[var(--reddb-spatial-inset-md)]" : "px-[var(--reddb-spatial-inset-md)] py-0", lineClass = gutter ? "leading-relaxed" : "leading-[calc(var(--reddb-spatial-control-height-md)-2px)]";
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
    "div",
    {
      "data-code-field": true,
      "data-mode": gutter ? "gutter" : "single-line",
      className: `grid gap-[var(--reddb-spatial-gap-sm)] ${className}`.trim(),
      children: [
        /* @__PURE__ */ jsxs(
          "label",
          {
            htmlFor: inputId,
            className: "text-sm font-medium text-foreground",
            children: [
              label,
              required ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: " *" }) }) : null
            ]
          }
        ),
        /* @__PURE__ */ jsxs("div", { className: "relative", children: [
          /* @__PURE__ */ jsxs(
            "div",
            {
              style: {
                minHeight: gutter ? "calc(var(--reddb-spatial-control-height-lg) * 3)" : void 0
              },
              className: `relative overflow-visible rounded-md ${gutter ? "border border-control-edge" : ""} bg-background font-mono text-editable-md text-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus ${controlClass}`,
              children: [
                gutter ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                  "div",
                  {
                    ref: gutterElement,
                    "data-code-gutter": true,
                    "aria-hidden": "true",
                    className: "pointer-events-none absolute inset-y-0 left-0 z-10 w-[calc(3ch+var(--reddb-spatial-inset-md))] overflow-hidden border-r border-muted bg-muted py-[var(--reddb-spatial-inset-sm)] text-right leading-relaxed text-ink-muted select-none",
                    children: lineNumbers.map((line, index) => {
                      return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                        "span",
                        {
                          "data-code-line-number": true,
                          className: "block pr-[var(--reddb-spatial-gap-sm)]",
                          children: line
                        }
                      ) }, index);
                    })
                  }
                ) }) : null,
                /* @__PURE__ */ jsx(
                  "pre",
                  {
                    style: {
                      paddingLeft: gutter ? "calc(3ch + var(--reddb-spatial-inset-lg))" : void 0
                    },
                    ref: highlightElement,
                    "data-code-highlight": true,
                    "aria-hidden": "true",
                    className: `pointer-events-none absolute inset-0 m-0 box-border overflow-hidden whitespace-pre ${gutter ? "" : "border border-transparent"} ${paddingClass} ${lineClass}`,
                    children: tokens.map((token, index) => {
                      return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                        "span",
                        {
                          "data-code-token": true,
                          "data-token-kind": token.kind,
                          "data-token-state": token.state,
                          className: tokenClass(token.kind, token.state),
                          children: token.value
                        }
                      ) }, `${token.start}:${token.end}:${index}`);
                    })
                  }
                ),
                gutter ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                  "textarea",
                  {
                    style: {
                      paddingLeft: "calc(3ch + var(--reddb-spatial-inset-lg))"
                    },
                    ref: (element) => {
                      inputElement.current = element;
                    },
                    id: inputId,
                    name,
                    placeholder,
                    required,
                    disabled,
                    rows,
                    value,
                    "aria-autocomplete": "list",
                    "aria-controls": open ? listboxId : void 0,
                    "aria-activedescendant": open && activeIndex >= 0 ? optionId(activeIndex) : void 0,
                    "aria-describedby": help ? helpId : void 0,
                    autoComplete: "off",
                    autoCapitalize: "off",
                    spellCheck: "false",
                    "data-code-input": true,
                    className: `relative z-10 block min-h-[inherit] w-full resize-y border-0 bg-transparent text-editable-md text-transparent caret-foreground outline-hidden placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-50 ${paddingClass} leading-relaxed ${inputClass}`.trim(),
                    onChange: handleInput,
                    onScroll: syncScroll,
                    onKeyDown: handleKeydown,
                    onFocus: (event) => refreshCompletion(event.currentTarget),
                    onClick: (event) => refreshCompletion(event.currentTarget)
                  }
                ) }) : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                  "input",
                  {
                    ref: (element) => {
                      inputElement.current = element;
                    },
                    id: inputId,
                    name,
                    placeholder,
                    required,
                    disabled,
                    type: "text",
                    value,
                    role: "combobox",
                    "aria-autocomplete": "list",
                    "aria-expanded": open,
                    "aria-controls": open ? listboxId : void 0,
                    "aria-activedescendant": open && activeIndex >= 0 ? optionId(activeIndex) : void 0,
                    "aria-describedby": help ? helpId : void 0,
                    autoComplete: "off",
                    autoCapitalize: "off",
                    spellCheck: "false",
                    "data-code-input": true,
                    className: `relative z-10 block h-full w-full rounded-md border border-control-edge bg-transparent text-editable-md text-transparent caret-foreground outline-hidden placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-50 ${paddingClass} ${lineClass} ${inputClass}`.trim(),
                    onChange: handleInput,
                    onScroll: syncScroll,
                    onKeyDown: handleKeydown,
                    onFocus: (event) => refreshCompletion(event.currentTarget),
                    onClick: (event) => refreshCompletion(event.currentTarget)
                  }
                ) })
              ]
            }
          ),
          open ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
            "div",
            {
              id: listboxId,
              role: "listbox",
              "aria-label": `${label} suggestions`,
              className: "absolute z-20 mt-[var(--reddb-spatial-gap-sm)] max-h-64 w-full overflow-y-auto rounded-md border border-elevation-overlay-border bg-elevation-overlay-surface p-[var(--reddb-spatial-inset-sm)] text-sm text-elevation-overlay-foreground shadow-elevation-overlay",
              children: filteredSuggestions.map((suggestion, index) => {
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                  "div",
                  {
                    id: optionId(index),
                    role: "option",
                    tabIndex: -1,
                    "aria-selected": activeIndex === index,
                    "aria-disabled": suggestion.disabled || void 0,
                    "data-code-suggestion": suggestion.value,
                    className: `flex min-h-[var(--reddb-spatial-control-height-md)] items-center rounded-md px-[var(--reddb-spatial-inset-md)] ${activeIndex === index ? "bg-foreground/10 text-foreground" : "bg-transparent"} ${suggestion.disabled ? "opacity-50" : "cursor-pointer"}`,
                    onMouseDown: (event) => event.preventDefault(),
                    onClick: () => choose(index),
                    onKeyDown: (event) => {
                      if (event.key === "Enter" || event.key === " ")
                        choose(index);
                    },
                    children: suggestion.label ?? suggestion.value
                  }
                ) }, suggestion.value);
              })
            }
          ) }) : null
        ] }),
        help ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("p", { id: helpId, className: "m-0 text-sm text-ink-muted", children: help }) }) : null
      ]
    }
  ) });
}
var CodeField_default = CodeField;
export {
  CodeField,
  CodeField_default as default
};
