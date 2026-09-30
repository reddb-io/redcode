// Generates the README artwork: docs/hero.svg and one banner per feature under docs/features.
// Run `bun script/readme/banners.ts` after editing a spec; the SVGs are output, never edited by hand.
import fs from "node:fs/promises"
import path from "node:path"

const FONT = "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace"

type Banner = {
  id: string
  kicker: string
  title: string
  tagline: string
  chips: string[]
  accent: string
  watermark: string
  description: string
  // Drawn in a 140x140 box, already stroked with the accent.
  glyph: string
}

const banners: Banner[] = [
  {
    id: "build",
    kicker: "MODE 01 / 04",
    title: "build",
    tagline: "The default. Reads, edits, runs, tests — with subagents when the work fans out.",
    chips: ["Tab cycles agents", "subagents", "permissions"],
    accent: "#ff2056",
    watermark: "▸",
    description: "Build mode: the default agent that reads, edits, runs and delegates.",
    glyph: `<rect x="0" y="0" width="140" height="140" rx="16" stroke-opacity="0.55"/>
      <line x1="0" y1="30" x2="140" y2="30" stroke-opacity="0.35"/>
      <circle cx="16" cy="15" r="3.5" fill="#ff2056" stroke="none"/>
      <circle cx="30" cy="15" r="3.5" fill="#ffffff" fill-opacity="0.25" stroke="none"/>
      <circle cx="44" cy="15" r="3.5" fill="#ffffff" fill-opacity="0.25" stroke="none"/>
      <path d="M22 58 L40 76 L22 94"/>
      <line x1="52" y1="94" x2="84" y2="94"/>
      <rect x="96" y="82" width="10" height="16" fill="#ff2056" stroke="none"/>
      <line x1="22" y1="116" x2="70" y2="116" stroke-opacity="0.35"/>`,
  },
  {
    id: "plan",
    kicker: "MODE 02 / 04",
    title: "plan",
    tagline: "Read everything, change nothing but the plan. Hand it to build when it is settled.",
    chips: ["read-only", "plan file", "plan_exit"],
    accent: "#58a6ff",
    watermark: "✓",
    description: "Plan mode: reads everything, writes only the plan file.",
    glyph: `<rect x="10" y="0" width="120" height="140" rx="14" stroke-opacity="0.55"/>
      <path d="M32 40 L42 50 L60 30"/>
      <line x1="74" y1="40" x2="110" y2="40" stroke-opacity="0.6"/>
      <path d="M32 74 L42 84 L60 64"/>
      <line x1="74" y1="74" x2="110" y2="74" stroke-opacity="0.6"/>
      <circle cx="40" cy="108" r="8" stroke-opacity="0.7"/>
      <line x1="74" y1="108" x2="98" y2="108" stroke-opacity="0.35"/>`,
  },
  {
    id: "design",
    kicker: "MODE 03 / 04",
    title: "design",
    tagline: "Work out what something should be by building it, and reviewing it in the browser.",
    chips: ["web · app · slides", "browser review", "DESIGN.md"],
    accent: "#f4c95d",
    watermark: "◇",
    description: "Design mode: interactive prototypes reviewed in the browser before any code changes.",
    glyph: `<rect x="0" y="6" width="140" height="122" rx="14" stroke-opacity="0.55"/>
      <line x1="0" y1="34" x2="140" y2="34" stroke-opacity="0.35"/>
      <circle cx="16" cy="20" r="3.5" fill="#f4c95d" stroke="none"/>
      <circle cx="30" cy="20" r="3.5" fill="#ffffff" fill-opacity="0.25" stroke="none"/>
      <rect x="18" y="50" width="54" height="34" rx="6" stroke-opacity="0.5"/>
      <rect x="18" y="96" width="104" height="14" rx="4" stroke-opacity="0.3"/>
      <rect x="82" y="50" width="40" height="34" rx="6" stroke-dasharray="5 4"/>
      <path d="M100 82 L100 100 L106 94 L114 108 L120 105 L112 91 L120 90 Z" fill="#f4c95d" stroke="#0d1117" stroke-width="2"/>`,
  },
  {
    id: "question",
    kicker: "MODE 04 / 04",
    title: "question",
    tagline: "Ask investigative questions of the codebase. Read-only tools, nothing is edited.",
    chips: ["read-only", "investigate", "no edits"],
    accent: "#ffa657",
    watermark: "?",
    description: "Question mode: investigative questions answered with read-only tool access.",
    glyph: `<circle cx="70" cy="70" r="64" stroke-opacity="0.45"/>
      <path d="M46 54 C46 34 94 34 94 56 C94 74 70 72 70 92"/>
      <circle cx="70" cy="112" r="5" fill="#ffa657" stroke="none"/>`,
  },
  {
    id: "goal",
    kicker: "ACROSS EVERY MODE",
    title: "/goal",
    tagline: "A definition of done the harness pursues across turns until it holds.",
    chips: ["/goal", "/goal-pause", "/goal-resume", "/goal-drop", "goal_complete"],
    accent: "#bc8cff",
    watermark: "◎",
    description: "Goal: a definition of done kept in session metadata and judged at the end of every turn.",
    glyph: `<circle cx="70" cy="70" r="64" stroke-opacity="0.4"/>
      <circle cx="70" cy="70" r="42" stroke-opacity="0.65"/>
      <circle cx="70" cy="70" r="20"/>
      <circle cx="70" cy="70" r="5" fill="#bc8cff" stroke="none"/>
      <path d="M70 70 L124 16" stroke-width="3.5"/>
      <path d="M124 16 L110 18 M124 16 L122 30"/>`,
  },
  {
    id: "vault",
    kicker: "PER-PROJECT SECRETS",
    title: "vault",
    tagline: "Secrets the model can use, obtain and ask for, without ever seeing them.",
    chips: ["{vault:name}", "vault_request", "host binding", "scrubbed output"],
    accent: "#f78166",
    watermark: "{}",
    description: "The vault: per-project secrets the model references by name and the harness resolves.",
    glyph: `<rect x="18" y="62" width="104" height="72" rx="14" stroke-opacity="0.6"/>
      <path d="M40 62 V44 C40 22 100 22 100 44 V62"/>
      <circle cx="70" cy="96" r="9"/>
      <line x1="70" y1="105" x2="70" y2="119"/>`,
  },
  {
    id: "intelligence",
    kicker: "DUAL REASONING",
    title: "S1 · S2",
    tagline: "S2 does the work. S1 checks it with typed questions before you trust it.",
    chips: ["/setup", "/intelligence", "TypeSafe / JEV", "single or dual"],
    accent: "#39c5cf",
    watermark: "::",
    description: "S1 and S2 reasoning roles: S2 generates and works, S1 evaluates with typed questions.",
    glyph: `<circle cx="48" cy="70" r="46" stroke-opacity="0.7"/>
      <circle cx="94" cy="70" r="46" stroke-opacity="0.4"/>
      <text x="26" y="78" font-size="22" font-weight="700" fill="#39c5cf" stroke="none" font-family="${FONT}">S1</text>
      <text x="92" y="78" font-size="22" font-weight="700" fill="#39c5cf" stroke="none" font-family="${FONT}">S2</text>`,
  },
  {
    id: "router",
    kicker: "PROVIDER",
    title: "RedRouter",
    tagline: "One key, many providers: pinned offers, auto variants, tools wired in.",
    chips: ["auto variant", "pinned offers", "model suggestions", "MCP auto-registration"],
    accent: "#f778ba",
    watermark: ">>",
    description: "RedRouter: a provider that routes across many models with pinned offers and an auto variant.",
    glyph: `<circle cx="16" cy="70" r="10" fill="#f778ba" stroke="none"/>
      <path d="M26 70 C60 70 60 24 104 24" stroke-opacity="0.7"/>
      <path d="M26 70 L104 70" stroke-opacity="0.7"/>
      <path d="M26 70 C60 70 60 116 104 116" stroke-opacity="0.7"/>
      <circle cx="118" cy="24" r="10"/>
      <circle cx="118" cy="70" r="10"/>
      <circle cx="118" cy="116" r="10"/>`,
  },
  {
    id: "monitors",
    kicker: "BACKGROUND WATCHERS",
    title: "monitors",
    tagline: "Background watches the agent starts, in one tab, waking the session when done.",
    chips: ["/monitors", "started", "finished", "expired"],
    accent: "#7ee787",
    watermark: "~",
    description: "Monitors: long-running background watches listed in one tab.",
    glyph: `<rect x="0" y="10" width="140" height="96" rx="14" stroke-opacity="0.55"/>
      <path d="M14 70 L40 70 L52 40 L70 92 L84 56 L94 70 L126 70"/>
      <line x1="50" y1="126" x2="90" y2="126" stroke-opacity="0.5"/>
      <line x1="70" y1="106" x2="70" y2="126" stroke-opacity="0.5"/>`,
  },
  {
    id: "workers",
    kicker: "REDSKILLS",
    title: "workers",
    tagline: "The RedSkills worker fleet as a tab in your session, not a dashboard.",
    chips: ["/workers", "drain", "stop", "per-project"],
    accent: "#ff2056",
    watermark: "##",
    description: "Workers: a live, project-scoped console over the RedSkills worker fleet.",
    glyph: `<rect x="0" y="0" width="62" height="62" rx="12" stroke-opacity="0.6"/>
      <rect x="78" y="0" width="62" height="62" rx="12" stroke-opacity="0.35"/>
      <rect x="0" y="78" width="62" height="62" rx="12" stroke-opacity="0.35"/>
      <rect x="78" y="78" width="62" height="62" rx="12" stroke-opacity="0.6"/>
      <circle cx="31" cy="31" r="7" fill="#ff2056" stroke="none"/>
      <circle cx="109" cy="109" r="7" fill="#ff2056" stroke="none"/>`,
  },
  {
    id: "stop-loss",
    kicker: "SAFETY NETS",
    title: "stop-loss",
    tagline: "Halts a stuck or runaway agent without punishing steady progress.",
    chips: ["loop guard", "stop-loss", "/budget", "opt-in limits"],
    accent: "#f0883e",
    watermark: "■",
    description: "Loop guard and stop-loss: halting an agent that repeats itself or spends without progress.",
    glyph: `<path d="M44 6 H96 L134 44 V96 L96 134 H44 L6 96 V44 Z" stroke-opacity="0.6"/>
      <line x1="46" y1="70" x2="94" y2="70" stroke-width="7"/>`,
  },
  {
    id: "compaction",
    kicker: "LONG SESSIONS",
    title: "compaction",
    tagline: "Focused background compaction that keeps anchors and drops secrets.",
    chips: ["/compact focus", "anchors", "background", "/restricted"],
    accent: "#3fb950",
    watermark: "↓",
    description: "Compaction: anchored, focused, background summaries that keep restricted content out.",
    glyph: `<line x1="10" y1="16" x2="130" y2="16" stroke-opacity="0.35"/>
      <line x1="10" y1="34" x2="130" y2="34" stroke-opacity="0.35"/>
      <path d="M36 62 L70 90 L104 62"/>
      <path d="M36 92 L70 120 L104 92" stroke-opacity="0.55"/>`,
  },
  {
    id: "worktrees",
    kicker: "ISOLATION",
    title: "worktrees",
    tagline: "Isolated git worktrees per task, and a background server that outlives the TUI.",
    chips: ["/worktrees", "--tmp", "redcode service"],
    accent: "#a5b4fc",
    watermark: "//",
    description: "Worktrees and the background service.",
    glyph: `<circle cx="30" cy="20" r="11"/>
      <circle cx="30" cy="120" r="11"/>
      <circle cx="110" cy="52" r="11"/>
      <line x1="30" y1="31" x2="30" y2="109"/>
      <path d="M30 86 C30 62 110 84 110 63" stroke-opacity="0.8"/>`,
  },
  {
    id: "voice",
    kicker: "VOICE INPUT",
    title: "dictation",
    tagline: "Speak into the composer through dit; you decide when it is sent.",
    chips: ["dit", "local socket", "never auto-submits"],
    accent: "#d2a8ff",
    watermark: "((",
    description: "Voice input: structured dictation delivered to the active composer.",
    glyph: `<rect x="48" y="0" width="44" height="80" rx="22" stroke-opacity="0.7"/>
      <path d="M22 62 C22 106 118 106 118 62"/>
      <line x1="70" y1="100" x2="70" y2="130"/>
      <line x1="46" y1="132" x2="94" y2="132" stroke-opacity="0.6"/>`,
  },
]

function chip(text: string, x: number, accent: string) {
  const width = Math.round(text.length * 8.6 + 18)
  return {
    width,
    svg: `<rect x="${x}" y="176" width="${width}" height="26" rx="13" fill="#ffffff" fill-opacity="0.04" stroke="${accent}" stroke-opacity="0.45"/>
      <text x="${x + 9}" y="194" font-size="13" fill="#c9d1d9">${escape(text)}</text>`,
  }
}

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function render(banner: Banner) {
  const id = banner.id
  let x = 262
  const chips = banner.chips.map((label) => {
    const rendered = chip(label, x, banner.accent)
    x += rendered.width + 10
    return rendered.svg
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 230" width="1200" height="230" role="img" aria-labelledby="t-${id} d-${id}">
  <title id="t-${id}">${escape(banner.title)}</title>
  <desc id="d-${id}">${escape(banner.description)}</desc>
  <defs>
    <linearGradient id="bg-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1117"/>
      <stop offset="1" stop-color="#07090d"/>
    </linearGradient>
    <radialGradient id="glow-${id}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${banner.accent}" stop-opacity="0.32"/>
      <stop offset="1" stop-color="${banner.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rule-${id}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${banner.accent}"/>
      <stop offset="1" stop-color="${banner.accent}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="grid-${id}" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0V24" fill="none" stroke="#ffffff" stroke-opacity="0.028" stroke-width="1"/>
    </pattern>
    <clipPath id="frame-${id}">
      <rect x="0" y="0" width="1200" height="230" rx="18"/>
    </clipPath>
  </defs>
  <g clip-path="url(#frame-${id})">
    <rect width="1200" height="230" fill="url(#bg-${id})"/>
    <rect width="1200" height="230" fill="url(#grid-${id})"/>
    <ellipse cx="130" cy="115" rx="360" ry="220" fill="url(#glow-${id})"/>
    <ellipse cx="1130" cy="230" rx="300" ry="170" fill="url(#glow-${id})" opacity="0.45"/>
    <rect x="0" y="0" width="6" height="230" fill="${banner.accent}"/>

    <g transform="translate(70 45)" fill="none" stroke="${banner.accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      ${banner.glyph}
    </g>

    <g font-family="${FONT}">
      <text x="262" y="60" font-size="11" fill="#6e7681" letter-spacing="2.5">${escape(banner.kicker)}</text>
      <text x="260" y="118" font-size="60" font-weight="700" letter-spacing="-2" fill="#f0f6fc">${escape(banner.title)}</text>
      <rect x="262" y="132" width="120" height="3" fill="url(#rule-${id})"/>
      <text x="262" y="160" font-size="18" fill="#8b949e">${escape(banner.tagline)}</text>
      ${chips.join("\n      ")}
      <text x="1130" y="200" font-size="120" font-weight="700" fill="${banner.accent}" fill-opacity="0.07" text-anchor="end" letter-spacing="-6">${escape(banner.watermark)}</text>
    </g>
  </g>
</svg>
`
}

const hero = () => {
  const items = [
    ["#ff2056", "build · plan · question"],
    ["#f4c95d", "design mode, in the browser"],
    ["#bc8cff", "/goal, judged every turn"],
    ["#f78166", "vault: secrets unseen"],
    ["#39c5cf", "S1 · S2 dual reasoning"],
    ["#f778ba", "RedRouter provider"],
    ["#7ee787", "monitors tab"],
    ["#ff2056", "RedSkills workers"],
    ["#f0883e", "loop guard, stop-loss"],
    ["#3fb950", "focused compaction"],
    ["#a5b4fc", "worktrees, service"],
    ["#d2a8ff", "voice dictation"],
  ]
  const rows = items
    .map(([color, label], index) => {
      const y = 132 + index * 21
      return `<circle cx="752" cy="${y - 4}" r="4" fill="${color}"/>
        <text x="768" y="${y}" font-size="14" fill="#c9d1d9">${escape(label)}</text>`
    })
    .join("\n        ")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" width="1200" height="420" role="img" aria-labelledby="rc-hero-title rc-hero-desc">
  <title id="rc-hero-title">Redcode — RedDB's terminal coding agent</title>
  <desc id="rc-hero-desc">Redcode is a terminal coding agent built on OpenCode, with a per-project secret vault, dual reasoning, goals, design mode, monitors and a live console for the RedDB worker fleet.</desc>
  <defs>
    <linearGradient id="rc-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1117"/>
      <stop offset="1" stop-color="#07090d"/>
    </linearGradient>
    <radialGradient id="rc-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ff2056" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#ff2056" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rc-rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff2056"/>
      <stop offset="1" stop-color="#ff2056" stop-opacity="0"/>
    </linearGradient>
    <pattern id="rc-grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0V24" fill="none" stroke="#ffffff" stroke-opacity="0.028" stroke-width="1"/>
    </pattern>
    <clipPath id="rc-frame">
      <rect x="0" y="0" width="1200" height="420" rx="18"/>
    </clipPath>
  </defs>
  <g clip-path="url(#rc-frame)">
    <rect width="1200" height="420" fill="url(#rc-bg)"/>
    <rect width="1200" height="420" fill="url(#rc-grid)"/>
    <ellipse cx="120" cy="60" rx="420" ry="300" fill="url(#rc-glow)"/>
    <ellipse cx="1120" cy="410" rx="360" ry="240" fill="url(#rc-glow)" opacity="0.5"/>
    <g font-family="${FONT}">
      <text x="72" y="150" font-size="88" font-weight="700" letter-spacing="-3"><tspan fill="#ff2056">red</tspan><tspan fill="#f0f6fc">code</tspan></text>
      <text x="72" y="204" font-size="34" font-weight="600" fill="#ff2056" letter-spacing="-1">terminal coding agent</text>
      <rect x="74" y="230" width="148" height="3" fill="url(#rc-rule)"/>
      <text x="72" y="272" font-size="19" fill="#8b949e">Durable sessions, secrets the model never sees,</text>
      <text x="72" y="298" font-size="19" fill="#8b949e">a second mind that checks the first.</text>
      <text x="72" y="332" font-size="11" fill="#6e7681" letter-spacing="2.5">BUILT ON</text>
      <g font-size="14">
        <rect x="72" y="342" width="106" height="28" rx="14" fill="#ffffff" fill-opacity="0.04" stroke="#ff2056" stroke-opacity="0.35"/>
        <text x="90" y="361" fill="#c9d1d9">OpenCode</text>
        <rect x="190" y="342" width="88" height="28" rx="14" fill="#ffffff" fill-opacity="0.04" stroke="#ffffff" stroke-opacity="0.08"/>
        <text x="208" y="361" fill="#c9d1d9">Effect</text>
      </g>
      <text x="72" y="398" font-size="11" fill="#6e7681" letter-spacing="2">RUNS AS</text>
      <text x="150" y="398" font-size="14" fill="#8b949e">TUI · HTTP server · ACP agent · MCP client</text>
    </g>
    <g font-family="${FONT}">
      <rect x="720" y="40" width="424" height="340" rx="12" fill="#0b0f15" stroke="#ffffff" stroke-opacity="0.09"/>
      <text x="744" y="76" font-size="12" fill="#6e7681" letter-spacing="1">WHAT REDCODE ADDS</text>
      <rect x="744" y="88" width="72" height="3" fill="url(#rc-rule)"/>
      <g>
        ${rows}
      </g>
    </g>
  </g>
</svg>
`
}

const root = path.resolve(import.meta.dir, "../..")
await fs.mkdir(path.join(root, "docs/features"), { recursive: true })
await Promise.all([
  Bun.write(path.join(root, "docs/hero.svg"), hero()),
  ...banners.map((banner) => Bun.write(path.join(root, "docs/features", `${banner.id}.svg`), render(banner))),
])
console.log(`wrote docs/hero.svg and ${banners.length} banners`)
