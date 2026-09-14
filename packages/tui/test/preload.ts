// No TUI test may launch a real browser from an automatic path (Design review launch, MCP OAuth);
// launcher tests inject fakes. Links a user clicks (ui/link.tsx, app.tsx, workers.tsx,
// dialog-retry-action.tsx) call `open` directly and are deliberately unguarded.
process.env.REDCODE_NO_BROWSER = "1"
process.env.REDCODE_DESIGN_NO_OPEN = "1"
