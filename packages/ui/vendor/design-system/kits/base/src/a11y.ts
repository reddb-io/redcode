// The accessible-name contract, as code (wave 5A).
//
// A form control or an icon-only Button that reaches the page with no
// accessible name is a defect an assistive-technology user meets as "edit
// text, blank" or "button". The type system does not require the naming props
// yet (making them required is a breaking decision kept for a later release),
// so the contract is enforced the way the deprecation window is: once per
// session, only in a development build, with a console warning that names the
// component and the ways to fix it. Production stays silent.

import { getContext, hasContext, setContext } from "svelte";

const warned = new Set<string>();

/**
 * Warn, once per session and only in development, that `component` broke an
 * accessibility contract. `problem` says what is missing, `fix` the props that
 * supply it. The sibling of `warnDeprecated`, for the same audience.
 */
export function warnA11y(component: string, problem: string, fix: string): void {
  if (!import.meta.env?.DEV) return;
  const key = `${component}\u0000${problem}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[reddb ${component}] ${problem}. ${fix}`);
}

const FIELD_CONTEXT = Symbol("reddb.field");

/** What a Field tells the control rendered inside it. */
export interface FieldContext {
  /** The Field's visible label, which names the control through `<label for>`. */
  readonly label: string;
}

/** Called by Field so the control inside it knows its name is owned. */
export function setFieldContext(context: FieldContext): void {
  setContext(FIELD_CONTEXT, context);
}

/** The enclosing Field's context, or `undefined` outside one. */
export function getFieldContext(): FieldContext | undefined {
  return hasContext(FIELD_CONTEXT) ? getContext<FieldContext>(FIELD_CONTEXT) : undefined;
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** Text a subtree contributes to a name, skipping what is hidden from assistive technology. */
function namedContent(node: Node): boolean {
  if (node.nodeType === 3) return nonEmpty(node.textContent);
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  if (element.getAttribute("aria-hidden") === "true") return false;
  if (nonEmpty(element.getAttribute("aria-label"))) return true;
  if (element.tagName === "IMG" && nonEmpty(element.getAttribute("alt"))) return true;
  if (element.tagName.toLowerCase() === "title") return nonEmpty(element.textContent);
  for (const child of element.childNodes) if (namedContent(child)) return true;
  return false;
}

/**
 * Whether `element` has an accessible name a screen reader can announce:
 * `aria-label`, an `aria-labelledby` that resolves to text, a native `<label>`
 * (wrapping or `for`), a `title`, or — for a button — its own content.
 *
 * A pragmatic approximation of the accessible-name computation, used only to
 * decide whether to warn in development, never to change what renders.
 */
export function hasAccessibleName(element: Element, { fromContent = false } = {}): boolean {
  if (nonEmpty(element.getAttribute("aria-label"))) return true;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (nonEmpty(labelledBy)) {
    const root = element.getRootNode() as Document | ShadowRoot;
    for (const id of labelledBy!.trim().split(/\s+/)) {
      const target = root.getElementById?.(id) ?? element.ownerDocument.getElementById(id);
      if (target && nonEmpty(target.textContent)) return true;
    }
  }
  const labels = (element as HTMLInputElement).labels;
  if (labels) for (const label of labels) if (nonEmpty(label.textContent)) return true;
  if (nonEmpty(element.getAttribute("title"))) return true;
  return fromContent && namedContent(element);
}

/** The ways a field gets its name, quoted in every field warning. */
export const FIELD_NAME_FIX =
  "Wrap it in a Field with a `label`, or pass `aria-label` or `aria-labelledby`, or point a native <label for> at its id";

/**
 * Warn in development when a mounted form control has no accessible name.
 * Checked after mount, so a `<label for>` written anywhere in the document
 * counts, exactly as it does for the browser.
 */
export function checkFieldName(component: string, element: Element | undefined): void {
  if (!import.meta.env?.DEV || !element) return;
  if (hasAccessibleName(element)) return;
  warnA11y(component, "renders a form control with no accessible name", `${FIELD_NAME_FIX}.`);
}
