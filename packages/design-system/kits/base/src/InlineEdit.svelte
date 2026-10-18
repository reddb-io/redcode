<script lang="ts">
  import { tick } from "svelte";
  import Button from "./Button.svelte";
  import Input from "./Input.svelte";
  import { inlineEdit } from "./inline-edit.variants";

  interface Props {
    /** Visible field name, also used to name its edit and input controls. */
    label: string;
    /** Committed text. Draft keystrokes never change this value. */
    value: string;
    /** Reports a committed value after validation and persistence succeed. */
    onvaluechange?: (value: string) => void;
    /** Whether the draft editor is open. */
    editing?: boolean;
    /** Reports entry into or exit from editing. */
    oneditingchange?: (editing: boolean) => void;
    /** Optional application validation; return an error to retain the draft. */
    validate?: (value: string) => string | undefined;
    /** Optional persistence operation. A rejection keeps the draft open. */
    onconfirm?: (value: string) => void | Promise<void>;
    /** Prevents opening or submitting the editor. */
    disabled?: boolean;
    /** Requires at least one non-whitespace character. Defaults to true. */
    required?: boolean;
    /** Optional maximum number of characters accepted by the native input. */
    maxlength?: number;
    /** Visible text when the committed value is empty. */
    emptyLabel?: string;
    /** Label of the action that opens the editor. */
    editLabel?: string;
    /** Label of the action that persists the draft. */
    saveLabel?: string;
    /** Label of the action that discards the draft. */
    cancelLabel?: string;
    /** Validation message for a required empty draft. */
    requiredMessage?: string;
    /** Message announced when persistence rejects. */
    saveErrorMessage?: string;
    /** Extra classes on the field group. */
    class?: string;
  }

  let { label, value = $bindable(), onvaluechange, editing = $bindable(false), oneditingchange,
    validate, onconfirm, disabled = false, required = true, maxlength, emptyLabel = "Untitled",
    editLabel = "Edit", saveLabel = "Save", cancelLabel = "Cancel", requiredMessage = "Enter a value.",
    saveErrorMessage = "Could not save. Try again.", class: className }: Props = $props();
  const id = $props.id();
  const styles = inlineEdit();
  let draft = $state("");
  let error = $state("");
  let saving = $state(false);
  let input = $state<HTMLInputElement>();
  let readRow = $state<HTMLDivElement>();
  let wasEditing = false;

  $effect(() => {
    if (editing && !wasEditing) {
      draft = value;
      error = "";
      void tick().then(() => { input?.focus(); input?.select(); });
    }
    wasEditing = editing;
  });

  async function setEditing(next: boolean) {
    editing = next;
    oneditingchange?.(next);
    if (!next) { await tick(); readRow?.querySelector<HTMLButtonElement>("button")?.focus(); }
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving || disabled) return;
    const candidate = draft;
    error = required && !candidate.trim() ? requiredMessage : validate?.(candidate) ?? "";
    if (error) { input?.focus(); return; }
    saving = true;
    try {
      await onconfirm?.(candidate);
      value = candidate;
      onvaluechange?.(candidate);
      await setEditing(false);
    } catch {
      error = saveErrorMessage;
      saving = false;
      await tick(); input?.focus();
    } finally { saving = false; }
  }
</script>

<div class={styles.root({ class: className })} data-inline-edit>
  <span id={`${id}-label`} class={styles.label()}>{label}</span>
  {#if editing}
    <form class={styles.row()} aria-labelledby={`${id}-label`} aria-busy={saving} onsubmit={save} novalidate>
      <Input bind:ref={input} value={draft} onvaluechange={(next) => { draft = String(next ?? ""); error = ""; }}
        aria-labelledby={`${id}-label`} aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined} {maxlength} {required} disabled={disabled || saving}
        class={styles.input()} onkeydown={(event) => {
          if (event.key === "Escape" && !event.isComposing && !saving) { event.preventDefault(); event.stopPropagation(); void setEditing(false); }
          if (event.key === "Enter" && event.isComposing) event.preventDefault();
        }} />
      <Button type="submit" size="sm" disabled={disabled || saving} loading={saving}>{saveLabel}</Button>
      <Button variant="ghost" size="sm" disabled={saving} onclick={() => setEditing(false)}>{cancelLabel}</Button>
    </form>
    {#if error}<p id={`${id}-error`} role="alert" class={styles.error()}>{error}</p>{/if}
  {:else}
    <div bind:this={readRow} class={styles.row()}>
      <span class={styles.value()}>{value || emptyLabel}</span>
      <Button size="sm" variant="ghost" {disabled} aria-label={`${editLabel} ${label}`} onclick={() => setEditing(true)}>{editLabel}</Button>
    </div>
  {/if}
</div>
