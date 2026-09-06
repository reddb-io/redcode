/**
 * How to build each kind of artifact well.
 *
 * Disclosed when needed rather than all at once: the mode's prompt carries the router — open every
 * playbook that matches before writing HTML — and `design_playbook` hands one over on request, so
 * the guidance costs tokens only on the turn that uses it. Ported from lavish-axi (MIT) and
 * rewritten for a prototype that has no network and a review page that is ours.
 */

export interface Playbook {
  readonly id: string
  readonly use_when: string
  readonly choose: readonly string[]
  readonly structure: readonly string[]
  readonly design_rules: readonly string[]
  readonly pitfalls: readonly string[]
  readonly review_notes: readonly string[]
}

export const ROUTER =
  "Open each matching playbook with design_playbook before writing HTML. Match against use_when; one artifact often combines several (a plan with a comparison and a diagram)."

export const PLAYBOOKS: readonly Playbook[] = [
  {
    id: "diagram",
    use_when: "Explain relationships, flows, state, architecture, and concepts with illustrations",
    choose: [
      "Default to hand-authored inline SVG: it gives proportion, emphasis, spatial metaphor, and annotation-ready structure that generated layouts cannot.",
      "Use Mermaid (../../vendor/mermaid.js, in a .mermaid container) only when the user asks for a diagram they can edit as a whiteboard.",
      "For large systems, draw a small overview illustration and put detail in module cards below it, instead of one dense auto-laid graph.",
    ],
    structure: [
      "Assume the reader knows nothing about the system or concept: explain from zero.",
      "Prefer one concept per diagram: a sequence of simple single-concept illustrations over one dense figure; layer understanding step by step.",
      "Lead with the question the diagram answers, not with the implementation detail that produced it.",
      "Keep the first visual to the core relationship, then put dense evidence or file references below it.",
      "For complex systems, separate topology from detail so the overview stays readable.",
    ],
    design_rules: [
      "Size with viewBox plus width:100%; never fixed pixel dimensions, and keep every element inside the viewBox.",
      "Color through currentColor and the page's CSS custom properties so figures follow the page's light and dark themes.",
      "Give every meaningful node, edge, and region a stable id and a <title> so the reviewer can annotate precisely.",
      "Keep labels to a few words and put prose beside the figure in HTML — SVG text does not wrap.",
      "Keep figures self-contained: no external images, fonts, or scripts; the prototype has no network.",
      "Check the figure in light, dark, and a narrow viewport before calling it done.",
    ],
    pitfalls: [
      "Do not cram every file or function into one figure when a layered explanation would be clearer.",
      "Do not hand-build boxes-and-arrows from div/flexbox: inline SVG owns figures, HTML owns the prose around them.",
      "Do not reach for Mermaid to save authoring effort — it surrenders position, size, and emphasis to the engine.",
      "Do not present unverified architecture claims as facts. Cite the files or commands that support them.",
    ],
    review_notes: [
      "A diagram should invite precise annotation: make modules, edges, and captions easy to click and discuss.",
      "When a relationship is uncertain, label it as a question so the user can resolve it in the review.",
    ],
  },
  {
    id: "table",
    use_when: "Turn dense records into scan-friendly review surfaces",
    choose: [
      "Use a table when rows share the same fields and the user needs to compare evidence quickly.",
      "Use cards when each record has a different shape or needs a long explanation.",
      "Use summaries above the table when counts, risk levels, or statuses change how the table should be read.",
    ],
    structure: [
      "Start with a short summary of what the rows prove or require.",
      "Group columns by the decision they support: identity, evidence, status, action.",
      "Keep raw details available, but make the primary status visible without reading every cell.",
    ],
    design_rules: [
      "Use semantic table markup — thead, th with scope, tbody — so a click on a cell is named by its row and column.",
      "Protect long paths, code symbols, URLs, and prose from overflowing on narrow screens.",
      "Use restrained color for status and severity so the table remains readable when printed or skimmed.",
    ],
    pitfalls: [
      "Do not paste a terminal table into HTML and call it done.",
      "Do not hide the important conclusion below a large undifferentiated grid.",
      "Do not use color as the only status signal.",
    ],
    review_notes: [
      "Rows should be easy annotation targets; the review names a cell by its row and column headers.",
      "If a row implies a follow-up change, include an action control that queues a specific prompt.",
    ],
  },
  {
    id: "comparison",
    use_when: "Show options, tradeoffs, and current vs target behavior",
    choose: [
      "Use before and after when the same system is changing over time.",
      "Use option cards when the user needs to choose between mutually exclusive directions.",
      "Use a scorecard only when the criteria are explicit and comparable.",
    ],
    structure: [
      "Name the decision at the top of the artifact.",
      "Show the concrete behavior or artifact shape for each side, not just abstract pros and cons.",
      "End with a recommendation only when the evidence actually supports one.",
    ],
    design_rules: [
      "Keep corresponding details aligned so differences are visible without hunting.",
      "Use visual hierarchy to separate primary tradeoffs from secondary notes.",
      "Make the cost of each option as visible as the benefit.",
      'Mark each option with data-option="a", data-option="b", … so the manifest\'s comparison check and the review can name it.',
    ],
    pitfalls: [
      "Do not make every option look equally recommended if one is clearly preferred.",
      "Do not compare vague summaries when concrete examples are available.",
      "Do not bury assumptions that would change the recommendation.",
    ],
    review_notes: [
      "The user should be able to annotate the exact option or tradeoff they want changed.",
      "If the goal is selection, provide controls that queue the chosen option with rationale, and record the pick in design.json's decisions.",
    ],
  },
  {
    id: "plan",
    use_when: "Explain a product or technical plan before implementation",
    choose: [
      "Use this when the user needs to inspect a feature approach before implementation begins.",
      "Use it when the user explicitly asked for a PRD, technical design, implementation plan or proposal.",
      "Use a lighter comparison or diagram playbook when the plan is only a single small design choice.",
    ],
    structure: [
      "Start with the goal, the current state, and desired behavior.",
      "Then describe a proposed approach, focusing on high level decisions.",
      "At the end, list the risks you see and the open questions you have, and follow the comparison playbook to offer options the user can choose from.",
    ],
    design_rules: [
      "Verify each claim against the codebase before presenting it as fact.",
      "When discussing frontend experiences, prefer visually mocking the experience under the project's own design system over describing it with text.",
      "The plan needs to be self-contained enough that another developer can read it and fully implement the proposal.",
    ],
    pitfalls: [
      "Do not leave resolved open questions in the artifact. Update existing content to reflect the decision and remove the open question.",
      "Do not only focus on ambiguous decisions and omit the actual proposal.",
      "Do not omit failure modes, migration concerns, or backwards compatibility questions.",
    ],
    review_notes: [
      "A plan and its uncertainties should be easy to annotate before code exists; what is settled goes into design.json so design_exit carries it into the plan file.",
    ],
  },
  {
    id: "code",
    use_when: "Render source code, code files, patches, PR diffs, and before/after code inside a prototype",
    choose: [
      "Use this whenever an artifact shows source code: a snippet, full file, patch, PR diff, local change set, or before/after code.",
      "Render one file as a numbered listing; render a change as a diff with an old and a new side; only build coordinated navigation when several files need it.",
      "Choose a side-by-side layout for careful review when width allows; choose a stacked (unified) layout when space is tight, changes are mostly additive, or mobile readability matters.",
    ],
    structure: [
      "Place the path, language, and reason to inspect the code immediately before each rendered file or diff.",
      "Keep evidence close to each claim with file paths, line references, or annotations next to the relevant code.",
      "For multi-file changes, group files by user-facing area or task instead of dumping a raw patch in repository order.",
    ],
    design_rules: [
      'The prototype has no network, so there is no diff library to load: render code as a <table> — one row per line, a line-number cell with user-select:none, a code cell in a monospace font with white-space:pre-wrap — and mark diff rows with data-change="added|removed|context" styled by the page\'s tokens.',
      "Give every line row a stable id (file path + line) so the reviewer can annotate a line and the note names it.",
      "Keep syntax highlighting minimal and hand-authored (comments, strings, keywords as spans) or skip it; readability and correct wrapping matter more than color.",
      "Let long lines wrap by default; keep horizontal scrolling only where alignment is essential.",
    ],
    pitfalls: [
      "Do not render code as static screenshots or markdown pasted into HTML.",
      "Do not load a highlighter or diff renderer from a CDN — it will not load.",
      "Do not show huge unrelated files when a focused range, a parsed patch, or a grouped summary would be clearer.",
      "Do not separate a claim from the code lines that prove it.",
    ],
    review_notes: [
      "Each file, hunk, and relevant line should be easy to annotate precisely; a table cell click is named by its row and column.",
      "When a user action should trigger a fix, queue prompts that name the file path, line range, and desired change.",
    ],
  },
  {
    id: "input",
    use_when:
      "Must be used when the agent needs to collect user input on decisions, choices, preferences, triage, scope, or other structured feedback from within the artifact",
    choose: [
      "Use this when the user needs to select, tune, triage, annotate, or edit a structured choice.",
      "Use controls for decisions the user can make faster visually than by writing a prompt.",
      "Use plain annotations when the artifact only needs open-ended feedback.",
    ],
    structure: [
      "Make each decision surface visible: what is being chosen, what the options mean, and what happens next.",
      "Keep reversible selection state local in the artifact until the user explicitly submits that question.",
      "Pair each question with a Submit or Queue answer control that sends exactly one prompt for the final answer.",
      "Show selected state separately from queued state so the user trusts what will be sent back.",
    ],
    design_rules: [
      "Native controls — radios, checkboxes, text inputs, selects, textareas, buttons, options, labels, disclosure summaries, contenteditable regions — are interactive automatically in the review: clicks toggle, focus, and type instead of annotating, so they need no data-redcode-action.",
      "For reversible choices, do not call window.redcodeDesign.queuePrompt() from radio change handlers or option click handlers. Those handlers only update local selected state.",
      "Use a per-question form submit or an explicit Queue answer button to read the current values and call window.redcodeDesign.queuePrompt() exactly once for the final answer.",
      "Put data-redcode-action only on custom (non-native) elements that should act like a control — a styled div or span you made clickable — so the review does not annotate it and shows a pointer.",
      'Wrap each question in data-redcode-question="id": an unsent answer for the same question replaces the earlier one, and its controls survive a reload of the prototype.',
      "Pass options such as tag, text, selector, target, data, queueKey, or element when they help the agent understand exactly what the user chose.",
      "Call window.redcodeDesign.sendQueuedPrompts() only when the control should immediately send committed feedback instead of waiting for the user to press Send.",
      "Make queued prompts specific enough that the agent can act without asking a follow-up question.",
      "Keep native browser controls accessible and readable on a phone.",
    ],
    pitfalls: [
      "Do not queue one prompt per radio change, checkbox toggle, dropdown change, or choice-button click when the user can still change their mind.",
      "Do not create controls whose queued prompt is unclear or too vague to execute.",
      "Do not hide the difference between selected locally and queued for the agent.",
      "Do not require interaction for content the user only needs to read.",
    ],
    review_notes: [
      "The review is strongest when the artifact becomes a focused review surface and not just a static page.",
      'A native single-choice question should submit the final value: <form data-redcode-question="plan" onsubmit="event.preventDefault(); const choice = new FormData(event.currentTarget).get(\'plan\'); if (choice) window.redcodeDesign.queuePrompt(\'Use the \' + choice + \' plan\', { tag: \'choice\', text: \'Plan: \' + choice, element: event.currentTarget, data: { question: \'plan\', answer: choice } });"><label><input type="radio" name="plan" value="Starter"> Starter</label><label><input type="radio" name="plan" value="Pro"> Pro</label><button type="submit">Queue this answer</button></form>',
      "A custom choice UI should make option buttons update local state, then use a separate Queue answer button with data-redcode-action to queue the final selected value.",
      "Use window.redcodeDesign.queuePrompt for user intent, not internal analytics or UI-only state changes.",
      "End input paths with an obvious way for the user to send feedback back to the agent.",
    ],
  },
  {
    id: "slides",
    use_when: "Create a deliberate presentation when slides are requested",
    choose: [
      "Use slides only when the user asks for a deck, presentation, talk, or paced walkthrough.",
      "Use a scroll page when the user needs reference material, detailed review, or dense evidence.",
      "Use one idea per slide when the artifact has a narrative arc.",
    ],
    structure: [
      "Plan the story before writing the slide markup.",
      "Open with the point, build context, show evidence, and close with the decision or next action.",
      "Vary slide composition so the deck does not feel like repeated cards.",
    ],
    design_rules: [
      'Set kind: "deck" in design.json and write one <section class="slide light|dark|hero light|hero dark"> per slide, exactly one theme class each, themes varied.',
      "Keep slide text sparse and let visuals carry the explanation.",
      "Use large type, strong alignment, and deliberate whitespace rather than dense paragraphs.",
      "Make navigation and screen-size assumptions explicit in the artifact.",
    ],
    pitfalls: [
      "Do not turn every explainer into slides by default.",
      "Do not paste a scroll-page outline into fixed-size frames without rewriting the narrative.",
      "Do not make consecutive slides with the same spatial composition unless repetition is the point.",
    ],
    review_notes: [
      "A deck can still collect feedback, but each prompt should refer to a slide or decision.",
      "Use slides for persuasion or presentation, not for dense code review.",
    ],
  },
]

export const ids = () => PLAYBOOKS.map((item) => item.id)

export const find = (id: string) => PLAYBOOKS.find((item) => item.id === id.trim().toLowerCase())

/** The list the agent sees when it asks for none in particular: ids and when each applies. */
export function list() {
  return [ROUTER, "", ...PLAYBOOKS.map((item) => `- ${item.id}: ${item.use_when}`)].join("\n")
}

/** One playbook, as the agent reads it. */
export function render(playbook: Playbook) {
  const section = (title: string, lines: readonly string[]) => [`## ${title}`, ...lines.map((line) => `- ${line}`), ""]
  return [
    `# Playbook: ${playbook.id}`,
    `Use when: ${playbook.use_when}`,
    "",
    ...section("Choose", playbook.choose),
    ...section("Structure", playbook.structure),
    ...section("Design rules", playbook.design_rules),
    ...section("Pitfalls", playbook.pitfalls),
    ...section("In the review", playbook.review_notes),
  ]
    .join("\n")
    .trimEnd()
}

export * as DesignPlaybooks from "./playbooks"
