import { describe, expect, test } from "bun:test"
import path from "node:path"
import { parseHTML } from "linkedom"
import { Design } from "@opencode/schema/design"
import { DesignPlaybooks } from "../src/design/playbooks"
import { DesignQuality } from "../src/design/quality"
import { injectScreens } from "../src/design/renderer-local"
import { tmpdir } from "./fixture/tmpdir"

const problems = (body: string) =>
  DesignQuality.screenProblems(parseHTML(`<!doctype html><html><body>${body}</body></html>`).document as never)

const designID = Design.ID.make("design_quality")

const job = (input: Partial<Design.Job> & Pick<Design.Job, "id" | "input">): Design.Job => ({
  designID,
  status: "completed",
  progress: 1,
  result: `/exports/${input.id}.html`,
  error: null,
  created: 1,
  finished: 2,
  ...input,
})

describe("DesignQuality.minimumControl", () => {
  test("uses a phone's touch target when the page emulates one and the WCAG target otherwise", () => {
    expect(DesignQuality.minimumControl(undefined)).toBe(24)
    expect(DesignQuality.minimumControl("ios")).toBe(44)
    expect(DesignQuality.minimumControl("android")).toBe(48)
  })
})

describe("DesignQuality.screenProblems", () => {
  test("accepts the same screen ids in different variants and targets in their own scope", () => {
    expect(
      problems(
        `<main data-design-variant="a"><div data-design-screen="list" data-design-label="List"><button data-design-go="detail">Open</button></div><div data-design-screen="detail" data-design-label="Detail"></div></main><main data-design-variant="b"><div data-design-screen="list" data-design-label="List"></div><div data-design-screen="detail" data-design-label="Detail"><button data-design-go="list">Back</button></div></main>`,
      ),
    ).toEqual([])
    // Page-level screens are reachable from inside a variant.
    expect(
      problems(
        `<div data-design-screen="help" data-design-label="Help"></div><main data-design-variant="a"><button data-design-go="help">Help</button></main>`,
      ),
    ).toEqual([])
  })

  test("describes what the runtime does with nested, repeated, invalid and misplaced screens", () => {
    expect(
      problems(
        `<main data-design-variant="a"><div data-design-screen="list" data-design-label="List"><button data-design-go="detail">Open</button><div data-design-screen="inner" data-design-label="Inner"></div></div><div data-design-screen="list" data-design-label="Again"></div><div data-design-screen="bad id"></div><div data-design-screen="nolabel"></div></main><main data-design-variant="b" data-design-screen="root" data-design-label="Root"></main>`,
      ),
    ).toEqual([
      'Screen "inner" is inside screen "list", so it is part of that screen rather than a screen of its own. Keep screens one level deep and use params for states inside a screen.',
      'Screen id "list" is repeated in variant "a"; only the first one is shown and the repeat stays hidden.',
      'Screen id "bad id" in variant "a" is invalid: use 1-64 letters, digits, underscores or hyphens. It stays hidden.',
      'Screen "nolabel" in variant "a" has no data-design-label; the review shows its id.',
      'data-design-screen="root" is on a variant root and is ignored; put screens inside the variant root.',
      'data-design-go="detail" in variant "a" names no screen there; the click does nothing.',
    ])
  })
})

describe("DesignQuality.screenWarnings", () => {
  test("parses an HTML entry and scans component sources for literal targets", async () => {
    await using temporary = await tmpdir()
    const html = path.join(temporary.path, "html")
    await Bun.write(
      path.join(html, "index.html"),
      `<!doctype html><body><section data-design-screen="cart" data-design-label="Cart"><button data-design-go="pay">Pay</button></section></body>`,
    )
    expect(await DesignQuality.screenNotice(html, "html", "index.html")).toBe(
      '\nScreen warnings:\n- data-design-go="pay" in the page names no screen there; the click does nothing.',
    )
    const react = path.join(temporary.path, "react")
    await Bun.write(
      path.join(react, "src/main.tsx"),
      `export const App = () => <><section data-design-screen="cart" data-design-label="Cart"><button data-design-go={"pay"}>Pay</button></section><section data-design-screen='pay'><button data-design-go="receipt">Done</button></section></>`,
    )
    await Bun.write(path.join(react, "node_modules/lib/index.js"), `x = '<a data-design-go="ignored">'`)
    expect(await DesignQuality.screenWarnings(react, "react", "src/main.tsx")).toEqual([
      'data-design-go="receipt" names no data-design-screen in the sources; the click does nothing.',
    ])
    expect(await DesignQuality.mentionsScreens(react)).toBe(true)
    expect(await DesignQuality.screenNotice(path.join(temporary.path, "missing"), "html", "index.html")).toBe("")
  })

  test("skips target checks when a screen id is computed and sources without screens entirely", async () => {
    await using temporary = await tmpdir()
    const computed = path.join(temporary.path, "computed")
    await Bun.write(
      path.join(computed, "src/main.tsx"),
      `export const Step = (props: { id: string }) => <section data-design-screen={props.id}><button data-design-go="review">Next</button></section>`,
    )
    expect(await DesignQuality.screenWarnings(computed, "react", "src/main.tsx")).toEqual([])
    const plain = path.join(temporary.path, "plain")
    await Bun.write(
      path.join(plain, "src/main.tsx"),
      `export const App = () => <button data-design-go="nowhere">Go</button>`,
    )
    expect(await DesignQuality.screenWarnings(plain, "react", "src/main.tsx")).toEqual([])
    expect(await DesignQuality.mentionsScreens(plain)).toBe(false)
  })
})

describe("DesignQuality.report", () => {
  test("renders audit checks such as small touch targets and slide overflow with their fixes", () => {
    const audit = job({
      id: "job_audit",
      input: { revision: "rev_current", format: "audit" },
      audit: {
        revision: "rev_current",
        findings: ["1 control is under the touch target"],
        scenarios: ["empty"],
        widths: [390],
        checks: [
          {
            rule: "small-control",
            severity: "review",
            selector: "#save",
            evidence: "Control is 32×32px, under the 44px touch target.",
            fix: "Give touch controls at least 44×44px (44pt on iOS, 48dp on Android), with spacing between neighbours.",
            width: 390,
            scenario: "empty",
          },
          {
            rule: "slide-overflow",
            severity: "error",
            selector: "#intro",
            evidence: "The slide is 1920×1400px, larger than the 1920×1080 canvas.",
            fix: "Keep each section.slide at 1920×1080.",
            width: 1920,
            screen: "intro",
          },
        ],
        captures: [{ file: "/exports/job_audit/390.png", width: 390, fullPage: true }],
      },
    })
    const previous = job({
      id: "job_previous",
      input: { revision: "rev_before", format: "audit" },
      created: 0,
      finished: 1,
      audit: { revision: "rev_before", findings: ["a", "b"], scenarios: [], widths: [390] },
    })

    const report = DesignQuality.report([audit, previous], "rev_current")

    expect(report).toContain("Current audit: job_audit, revision rev_current.")
    expect(report).toContain("Exercised scenarios: 1. Findings: 1.")
    expect(report).toContain(
      "REVIEW small-control · 390px · empty · #save: Control is 32×32px, under the 44px touch target. Fix: Give touch controls",
    )
    expect(report).toContain(
      "ERROR slide-overflow · 1920px · slide intro · #intro: The slide is 1920×1400px, larger than the 1920×1080 canvas.",
    )
    expect(report).toContain("390px page initial (full page): /exports/job_audit/390.png")
    expect(report).toContain("Previous audit job_previous (rev_before): 2 findings.")
    expect(report).toContain("End-of-round review")
    expect(report).toContain("Do not edit, republish or start another correction cycle")
    expect(report).toContain("For automatic end-of-round reviews")
    expect(report).toContain("An explicit browser Run anti-slop request authorizes one correction pass")
    expect(report).toContain("stop after that final audit without another correction pass")
  })

  test("names each check's key, the reuse evidence and what stayed flagged since the previous audit", () => {
    const check = (rule: string, extra: Partial<Design.AuditCheck> = {}): Design.AuditCheck => ({
      rule,
      severity: "review",
      selector: '[data-design-variant="bold"]',
      evidence: "Signal.",
      fix: "Fix.",
      width: 1440,
      ...extra,
    })
    const repeated = check("variants-too-similar", { key: "variants-too-similar@calm~bold", variant: "bold", judged: "confirmed" })
    const current = job({
      id: "job_now",
      input: { revision: "rev_now", format: "audit" },
      created: 3,
      finished: 4,
      audit: {
        revision: "rev_now",
        findings: [],
        scenarios: [],
        widths: [1440],
        checks: [
          check("redeclared-component", { key: "redeclared-component@Card", severity: "info", judged: "rejected" }),
          repeated,
        ],
        reuse: { imported: ["Button"], redeclared: ["Card"], files: ["src/components/ui/button.tsx"], ratio: 0.5 },
      },
    })
    const previous = job({
      id: "job_then",
      input: { revision: "rev_then", format: "audit" },
      audit: {
        revision: "rev_then",
        findings: [],
        scenarios: [],
        widths: [1440],
        checks: [repeated, check("placeholder-link", { selector: "a" })],
      },
    })
    const report = DesignQuality.report([current, previous], "rev_now")
    const lines = report.split("\n")
    expect(report).toContain("Design-system reuse: 1 component imported (Button) from 1 file; 1 re-declared (Card); reuse 50%.")
    // The info check asks for nothing, so it is listed after the review check.
    expect(lines.findIndex((line) => line.startsWith("REVIEW variants-too-similar"))).toBeLessThan(
      lines.findIndex((line) => line.startsWith("INFO redeclared-component")),
    )
    expect(report).toContain("[key variants-too-similar@calm~bold]")
    expect(report).toContain('add a decision with id "accept:<key>"')
    expect(report).toContain(
      "By key since job_then: 1 still flagged (variants-too-similar@calm~bold), 1 no longer flagged, 0 new.",
    )
  })

  test("merges repeated widths and keeps errors and design-wide findings ahead of a noisy audit's cap", () => {
    const check = (rule: string, extra: Partial<Design.AuditCheck> = {}): Design.AuditCheck => ({
      rule,
      severity: "review",
      selector: "body",
      evidence: "Signal.",
      fix: "Fix.",
      width: 1440,
      ...extra,
    })
    // What a renderer appends: per-viewport checks first, the repetition and reuse checks last.
    const noisy = [
      ...[390, 768, 1440].flatMap((width) =>
        Array.from({ length: 41 }, (_, index) =>
          check("small-control", { selector: `#control-${index}`, width, evidence: `Control height is ${width / 60}px.` }),
        ),
      ),
      check("broken-image", { severity: "error", selector: "img", width: 768 }),
      check("variants-too-similar", { key: "variants-too-similar@calm~bold", variant: "bold", judged: "confirmed" }),
      check("redeclared-component", { key: "redeclared-component@Card", selector: "source src/main.tsx:4" }),
      check("redeclared-component", { key: "redeclared-component@Panel", severity: "info", judged: "rejected" }),
    ]
    const settled = DesignQuality.settle(noisy, [
      { id: DesignQuality.accepted("small-control@page:#control-40"), text: "A dense toolbar by design." },
    ])
    expect(settled.checks).toHaveLength(124)
    expect(settled.findings).toEqual(["1 accepted exception recorded in decisions not flagged again: small-control@page:#control-40."])
    const audit = job({
      id: "job_noisy",
      input: { revision: "rev_noisy", format: "audit" },
      audit: { revision: "rev_noisy", findings: settled.findings, scenarios: [], widths: [390, 768, 1440], checks: settled.checks },
    })
    const lines = DesignQuality.report([audit], "rev_noisy").split("\n")
    const listed = lines.filter((line) => /^(?:ERROR|REVIEW|INFO) /.test(line))
    expect(lines).toContain(
      "Checks: 124, 44 distinct after merging repeats at other widths and scenarios; the 30 that ask the most are listed (errors, then review, then info).",
    )
    expect(listed).toHaveLength(30)
    expect(listed[0]).toStartWith("ERROR broken-image · 768px")
    expect(listed[1]).toStartWith("REVIEW variants-too-similar · 1440px · bold")
    expect(listed[2]).toStartWith("REVIEW redeclared-component · 1440px")
    // One line per control, with every width it was found at and the narrowest occurrence's evidence.
    expect(listed[3]).toBe(
      "REVIEW small-control · 390/768/1440px · #control-0: Control height is 6.5px. Fix: Fix. [key small-control@page:#control-0]",
    )
    expect(lines).toContain("14 further distinct checks (0 error, 13 review, 1 info) in /exports/job_noisy.html; inspect the full report.")
    // A quiet audit gets no merge summary.
    const quiet = job({
      id: "job_quiet",
      input: { revision: "rev_quiet", format: "audit" },
      audit: { revision: "rev_quiet", findings: [], scenarios: [], widths: [1440], checks: [check("placeholder-link")] },
    })
    expect(DesignQuality.report([quiet], "rev_quiet")).not.toContain("distinct after merging")
  })

  test("asks for a fresh audit when only an older revision was audited", () => {
    const stale = job({
      id: "job_stale",
      input: { revision: "rev_before", format: "audit" },
      audit: { revision: "rev_before", findings: [], scenarios: [], widths: [1280] },
    })

    expect(DesignQuality.report([stale], "rev_current")).toContain(
      "No completed audit for current revision rev_current. Publish if needed, then call design_export",
    )
  })

  test("lists the notes of a round that arrived after its verify", () => {
    const verify = job({
      id: "job_verify",
      input: { revision: "rev_current", format: "verify", round: 1 },
      verify: {
        revision: "rev_current",
        round: 1,
        width: 1280,
        notes: [
          {
            feedback: "msg_first",
            index: 1,
            label: "button Save",
            found: true,
            blocking: false,
            findings: [],
            scenarios: [],
            reason: "found, no findings",
          },
        ],
        findings: [],
      },
    })

    const report = DesignQuality.report([verify], "rev_current", [
      {
        feedback: "msg_first",
        index: 1,
        round: 1,
        item: { target: "#save", text: "Say what is saved" },
        status: "resolved",
        updated: 1,
      },
      {
        feedback: "msg_late",
        index: 2,
        round: 1,
        item: { target: "#cancel", text: "Arrived later" },
        status: "open",
        updated: 1,
      },
    ])

    expect(report).toContain("Current verify: job_verify, round 1, revision rev_current.")
    expect(report).toContain("1. msg_first #1 button Save: found, no findings")
    expect(report).toContain("1 note of round 1 arrived after this verify (msg_late #2); run the verify again")
  })

  test("quotes the reviewer's note under each verified note, so one the agent did not act on is in view", () => {
    const seen = (index: number, label: string, extra: Partial<Design.VerifyNote> = {}): Design.VerifyNote => ({
      feedback: "msg_round",
      index,
      label,
      found: true,
      blocking: false,
      findings: [],
      scenarios: [],
      reason: "found; no findings",
      ...extra,
    })
    const verify = job({
      id: "job_verify",
      input: { revision: "rev_current", format: "verify", round: 3 },
      verify: {
        revision: "rev_current",
        round: 3,
        width: 1280,
        notes: [
          seen(1, 'button "Rotate"', { before: "/captures/1-before.png", after: "/captures/1-after.png" }),
          seen(2, 'td "Actions"', { findings: ["review · small-control: Control height is 28px."] }),
          seen(3, "svg"),
          seen(4, "footer"),
        ],
        findings: [],
      },
    })
    // The longest note ends on an astral character that a cut by UTF-16 units would split.
    const long = `${"é".repeat(199)}😀 and the rest is cut`
    const note = (index: number, text: string): Design.Note => ({
      feedback: "msg_round",
      index,
      round: 3,
      item: { target: `#note-${index}`, text },
      status: "open",
      updated: 1,
    })

    const lines = DesignQuality.report([verify], "rev_current", [
      note(1, "Rotate per secret, not per client"),
      note(2, "Align the three actions\nin every row"),
      note(3, long),
    ]).split("\n")

    const header = lines.findIndex((line) => line.startsWith("Current verify: job_verify, round 3"))
    expect(lines[header]).toContain("One line per note with what the verify saw, then the reviewer's note;")
    expect(lines.slice(header + 1, header + 9)).toEqual([
      '1. msg_round #1 button "Rotate": found; no findings before: /captures/1-before.png after: /captures/1-after.png',
      "Note: Rotate per secret, not per client",
      '2. msg_round #2 td "Actions": found; no findings findings: review · small-control: Control height is 28px.',
      "Note: Align the three actions",
      "    in every row",
      "3. msg_round #3 svg: found; no findings",
      `Note: ${"é".repeat(199)}😀…`,
      // A note the caller did not pass is still reported, without words that are not known.
      "4. msg_round #4 footer: found; no findings",
    ])
    expect(lines[header + 9]).toStartWith("Record each note with design_document update")
    // It ends on what the round still waits for, with the reviewer's words, so recording starts from this page.
    const status = lines.indexOf("Round 3: 0 of 3 addressed, 0 recorded. Still without an outcome:")
    expect(status).toBeGreaterThan(header + 9)
    expect(lines.slice(status + 1)).toEqual([
      "msg_round #1 [open] #note-1",
      "Note: Rotate per secret, not per client",
      "msg_round #2 [open] #note-2",
      "Note: Align the three actions",
      "    in every row",
      "msg_round #3 [open] #note-3",
      `Note: ${"é".repeat(199)}😀…`,
    ])
    // A design with nothing left adds nothing.
    expect(DesignQuality.report([verify], "rev_current", [{ ...note(1, "Done"), status: "resolved" }])).not.toContain(
      "Still without an outcome",
    )
  })
})

describe("screen runtime and guidance", () => {
  test("places the runtime inside head, never before the doctype or inside a header", () => {
    const withHead = injectScreens(
      '<!doctype html><html lang="en"><head><title>x</title></head><body><header>Top</header></body></html>',
    )
    expect(withHead).toStartWith('<!doctype html><html lang="en"><head><script>(')
    expect(withHead).toContain("<body><header>Top</header>")
    expect(injectScreens("<!doctype html><header>Top</header>")).toStartWith("<!doctype html><script>(")
    expect(injectScreens("<!doctype html><header>Top</header>")).toEndWith("</script><header>Top</header>")
    expect(injectScreens("<html><body><header>Top</header></body></html>")).toStartWith("<html><script>(")
    expect(injectScreens("<p>Bare</p>")).toStartWith("<script>(")
  })

  test("the flow playbook documents screens for multi-page apps", () => {
    const flow = DesignPlaybooks.find("flow")
    expect(flow).toBeDefined()
    const rendered = flow ? DesignPlaybooks.render(flow) : ""
    expect(rendered).toContain("data-design-screen")
    expect(rendered).toContain("multi-page app")
  })
})
